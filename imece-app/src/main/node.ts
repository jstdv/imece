import { EventEmitter } from 'events'
import { ImeceConfig } from './config'
import crypto from 'crypto'

export interface NodeStats {
  challengesPassed: number
  challengesFailed: number
  reliability: number
  balance: number
  totalEarned: number
  pipelineStatus: string
  shardStatus: string
  reconnectAttempts: number
  uptimeSeconds: number
}

export class ImeceNode extends EventEmitter {
  private config: ImeceConfig
  private _isRunning = false
  private _status = 'stopped'
  private _stats: NodeStats = {
    challengesPassed: 0,
    challengesFailed: 0,
    reliability: 1.0,
    balance: 0,
    totalEarned: 0,
    pipelineStatus: 'unknown',
    shardStatus: 'starting',
    reconnectAttempts: 0,
    uptimeSeconds: 0,
  }

  private heartbeatTimer: NodeJS.Timeout | null = null
  private challengeTimer: NodeJS.Timeout | null = null
  private balanceTimer: NodeJS.Timeout | null = null
  private uptimeTimer: NodeJS.Timeout | null = null
  private startTime: number = 0

  // Intervals (ms)
  private readonly HEARTBEAT_INTERVAL = 30_000
  private readonly SHARD_HEARTBEAT_INTERVAL = 30_000
  private readonly CHALLENGE_INTERVAL = 300_000
  private readonly BALANCE_INTERVAL = 60_000

  constructor(config: ImeceConfig) {
    super()
    this.config = config
  }

  get isRunning() { return this._isRunning }
  get status() { return this._status }
  get stats() { return { ...this._stats } }

  async start() {
    if (this._isRunning) return
    this._isRunning = true
    this.startTime = Date.now()
    this.setStatus('connecting')

    try {
      // Verify coordinator is reachable
      await this.checkCoordinator()

      // Register shard
      await this.registerShard()

      // Start loops
      this.startHeartbeatLoop()
      this.startChallengeLoop()
      this.startBalanceLoop()
      this.startUptimeLoop()

      this.setStatus('contributing')
      this.emit('stats', this._stats)
    } catch (err: any) {
      this.setStatus('error')
      this.emit('error', err.message)
    }
  }

  async stop() {
    this._isRunning = false

    // Clear all timers
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.challengeTimer) clearInterval(this.challengeTimer)
    if (this.balanceTimer) clearInterval(this.balanceTimer)
    if (this.uptimeTimer) clearInterval(this.uptimeTimer)

    // Deregister shard
    try {
      await this.fetch(`/inference/shards/${this.config.nodeId}`, 'DELETE')
    } catch {}

    this.setStatus('stopped')
  }

  // ── Private loops ────────────────────────────────────────────

  private startHeartbeatLoop() {
    const beat = async () => {
      if (!this._isRunning) return
      try {
        await this.fetch(`/nodes/${this.config.nodeId}/heartbeat`, 'POST')

        // Shard heartbeat
        const shardRes = await this.fetch(
          `/inference/shards/heartbeat/${this.config.nodeId}`, 'POST'
        ).catch(() => null)

        if (!shardRes) {
          // Coordinator restarted — re-register shard
          this._stats.reconnectAttempts++
          await this.registerShard()
        } else {
          this._stats.shardStatus = 'registered'
        }

        this.emit('stats', this._stats)
      } catch {
        this._stats.reconnectAttempts++
        this.emit('stats', this._stats)
      }
    }

    beat()
    this.heartbeatTimer = setInterval(beat, this.HEARTBEAT_INTERVAL)
  }

  private startChallengeLoop() {
    const challenge = async () => {
      if (!this._isRunning) return
      try {
        await this.runChallenge()
      } catch {}
    }

    this.challengeTimer = setInterval(challenge, this.CHALLENGE_INTERVAL)
  }

  private startBalanceLoop() {
    const refresh = async () => {
      if (!this._isRunning) return
      try {
        const data = await this.fetch(`/tokens/${this.config.nodeId}/balance`, 'GET')
        this._stats.balance = data.balance ?? 0
        this._stats.totalEarned = data.total_earned ?? 0
        this.emit('balance', this._stats.balance)
        this.emit('stats', this._stats)
      } catch {}
    }

    refresh()
    this.balanceTimer = setInterval(refresh, this.BALANCE_INTERVAL)
  }

  private startUptimeLoop() {
    this.uptimeTimer = setInterval(() => {
      this._stats.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000)
      this.emit('stats', this._stats)
    }, 1000)
  }

  // ── Challenge execution ───────────────────────────────────────

  private async runChallenge() {
    const task = await this.fetch(
      `/tasks/dispatch/${this.config.nodeId}`, 'POST'
    ).catch(() => null)

    if (!task) return

    const hash = this.computeChallengeHash(
      task.payload?.prompt ?? '',
      task.layer_start ?? this.config.layerStart,
      task.layer_end ?? this.config.layerEnd,
      task.model_id ?? this.config.modelId,
    )

    const result = await this.fetch('/tasks/result', 'POST', {
      task_id: task.task_id,
      node_id: this.config.nodeId,
      result_hash: hash,
      flops_delivered: task.flops_estimated ?? 1.0,
      execution_time_ms: 100,
    }).catch(() => null)

    if (result) {
      if (result.passed) {
        this._stats.challengesPassed++
      } else {
        this._stats.challengesFailed++
      }
      this._stats.reliability = result.reliability ?? this._stats.reliability
      this.emit('stats', this._stats)
    }
  }

  // Deterministic hash — must match server-side _generate_challenge_answer
  private computeChallengeHash(
    prompt: string,
    layerStart: number,
    layerEnd: number,
    modelId: string,
  ): string {
    const content = JSON.stringify(
      { layer_end: layerEnd, layer_start: layerStart, model_id: modelId, prompt, temperature: 0.0 }
    )
    return crypto.createHash('sha256').update(content).digest('hex')
  }

  // ── Shard registration ────────────────────────────────────────

  private async registerShard() {
    this._stats.shardStatus = 'registering'
    this.emit('stats', this._stats)

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
        })

        this._stats.shardStatus = 'registered'
        this.emit('stats', this._stats)
        return
      } catch {
        this._stats.reconnectAttempts++
        await this.sleep(5000)
      }
    }

    this._stats.shardStatus = 'failed'
    this.emit('stats', this._stats)
  }

  private async checkCoordinator() {
    const res = await this.fetch('/health', 'GET')
    if (!res) throw new Error('Coordinator unreachable')
  }

  // ── HTTP helper ───────────────────────────────────────────────

  private async fetch(path: string, method: string, body?: object): Promise<any> {
    const { default: fetch } = await import('node-fetch')
    const res = await fetch(`${this.config.serverUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`${res.status}: ${text}`)
    }
    return res.json()
  }

  private setStatus(status: string) {
    this._status = status
    this.emit('status', status)
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
