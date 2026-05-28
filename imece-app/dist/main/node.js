"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImeceNode = void 0;
const events_1 = require("events");
const crypto_1 = __importDefault(require("crypto"));
class ImeceNode extends events_1.EventEmitter {
    constructor(config) {
        super();
        this._isRunning = false;
        this._status = 'stopped';
        this._stats = {
            challengesPassed: 0,
            challengesFailed: 0,
            reliability: 1.0,
            balance: 0,
            totalEarned: 0,
            pipelineStatus: 'unknown',
            shardStatus: 'starting',
            reconnectAttempts: 0,
            uptimeSeconds: 0,
        };
        this.heartbeatTimer = null;
        this.challengeTimer = null;
        this.balanceTimer = null;
        this.uptimeTimer = null;
        this.startTime = 0;
        // Intervals (ms)
        this.HEARTBEAT_INTERVAL = 30000;
        this.SHARD_HEARTBEAT_INTERVAL = 30000;
        this.CHALLENGE_INTERVAL = 300000;
        this.BALANCE_INTERVAL = 60000;
        this.config = config;
    }
    get isRunning() { return this._isRunning; }
    get status() { return this._status; }
    get stats() { return { ...this._stats }; }
    async start() {
        if (this._isRunning)
            return;
        this._isRunning = true;
        this.startTime = Date.now();
        this.setStatus('connecting');
        try {
            // Verify coordinator is reachable
            await this.checkCoordinator();
            // Register shard
            await this.registerShard();
            // Start loops
            this.startHeartbeatLoop();
            this.startChallengeLoop();
            this.startBalanceLoop();
            this.startUptimeLoop();
            this.setStatus('contributing');
            this.emit('stats', this._stats);
        }
        catch (err) {
            this.setStatus('error');
            this.emit('error', err.message);
        }
    }
    async stop() {
        this._isRunning = false;
        // Clear all timers
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        if (this.challengeTimer)
            clearInterval(this.challengeTimer);
        if (this.balanceTimer)
            clearInterval(this.balanceTimer);
        if (this.uptimeTimer)
            clearInterval(this.uptimeTimer);
        // Deregister shard
        try {
            await this.fetch(`/inference/shards/${this.config.nodeId}`, 'DELETE');
        }
        catch { }
        this.setStatus('stopped');
    }
    // ── Private loops ────────────────────────────────────────────
    startHeartbeatLoop() {
        const beat = async () => {
            if (!this._isRunning)
                return;
            try {
                await this.fetch(`/nodes/${this.config.nodeId}/heartbeat`, 'POST');
                // Shard heartbeat
                const shardRes = await this.fetch(`/inference/shards/heartbeat/${this.config.nodeId}`, 'POST').catch(() => null);
                if (!shardRes) {
                    // Coordinator restarted — re-register shard
                    this._stats.reconnectAttempts++;
                    await this.registerShard();
                }
                else {
                    this._stats.shardStatus = 'registered';
                }
                this.emit('stats', this._stats);
            }
            catch {
                this._stats.reconnectAttempts++;
                this.emit('stats', this._stats);
            }
        };
        beat();
        this.heartbeatTimer = setInterval(beat, this.HEARTBEAT_INTERVAL);
    }
    startChallengeLoop() {
        const challenge = async () => {
            if (!this._isRunning)
                return;
            try {
                await this.runChallenge();
            }
            catch { }
        };
        this.challengeTimer = setInterval(challenge, this.CHALLENGE_INTERVAL);
    }
    startBalanceLoop() {
        const refresh = async () => {
            if (!this._isRunning)
                return;
            try {
                const data = await this.fetch(`/tokens/${this.config.nodeId}/balance`, 'GET');
                this._stats.balance = data.balance ?? 0;
                this._stats.totalEarned = data.total_earned ?? 0;
                this.emit('balance', this._stats.balance);
                this.emit('stats', this._stats);
            }
            catch { }
        };
        refresh();
        this.balanceTimer = setInterval(refresh, this.BALANCE_INTERVAL);
    }
    startUptimeLoop() {
        this.uptimeTimer = setInterval(() => {
            this._stats.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
            this.emit('stats', this._stats);
        }, 1000);
    }
    // ── Challenge execution ───────────────────────────────────────
    async runChallenge() {
        const task = await this.fetch(`/tasks/dispatch/${this.config.nodeId}`, 'POST').catch(() => null);
        if (!task)
            return;
        const hash = this.computeChallengeHash(task.payload?.prompt ?? '', task.layer_start ?? this.config.layerStart, task.layer_end ?? this.config.layerEnd, task.model_id ?? this.config.modelId);
        const result = await this.fetch('/tasks/result', 'POST', {
            task_id: task.task_id,
            node_id: this.config.nodeId,
            result_hash: hash,
            flops_delivered: task.flops_estimated ?? 1.0,
            execution_time_ms: 100,
        }).catch(() => null);
        if (result) {
            if (result.passed) {
                this._stats.challengesPassed++;
            }
            else {
                this._stats.challengesFailed++;
            }
            this._stats.reliability = result.reliability ?? this._stats.reliability;
            this.emit('stats', this._stats);
        }
    }
    // Deterministic hash — must match server-side _generate_challenge_answer
    computeChallengeHash(prompt, layerStart, layerEnd, modelId) {
        const content = JSON.stringify({ layer_end: layerEnd, layer_start: layerStart, model_id: modelId, prompt, temperature: 0.0 });
        return crypto_1.default.createHash('sha256').update(content).digest('hex');
    }
    // ── Shard registration ────────────────────────────────────────
    async registerShard() {
        this._stats.shardStatus = 'registering';
        this.emit('stats', this._stats);
        for (let attempt = 0; attempt < 10; attempt++) {
            try {
                await this.fetch('/inference/shards/register', 'POST', {
                    node_id: this.config.nodeId,
                    model_id: this.config.modelId,
                    layer_start: this.config.layerStart,
                    layer_end: this.config.layerEnd,
                    vram_gb: this.config.vramGb || 0,
                    region: this.config.region,
                    host: '127.0.0.1',
                    port: this.config.shardPort,
                    transports: [{ transport: 'http', version: '1.1', port: this.config.shardPort, priority: 1 }],
                });
                this._stats.shardStatus = 'registered';
                this.emit('stats', this._stats);
                return;
            }
            catch {
                this._stats.reconnectAttempts++;
                await this.sleep(5000);
            }
        }
        this._stats.shardStatus = 'failed';
        this.emit('stats', this._stats);
    }
    async checkCoordinator() {
        const res = await this.fetch('/health', 'GET');
        if (!res)
            throw new Error('Coordinator unreachable');
    }
    // ── HTTP helper ───────────────────────────────────────────────
    async fetch(path, method, body) {
        const { default: fetch } = await Promise.resolve().then(() => __importStar(require('node-fetch')));
        const res = await fetch(`${this.config.serverUrl}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`${res.status}: ${text}`);
        }
        return res.json();
    }
    setStatus(status) {
        this._status = status;
        this.emit('status', status);
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.ImeceNode = ImeceNode;
