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
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const electron_store_1 = __importDefault(require("electron-store"));
const node_1 = require("./node");
const config_1 = require("./config");
// ── Store ─────────────────────────────────────────────────────
const store = new electron_store_1.default({ defaults: config_1.defaultConfig });
// ── State ─────────────────────────────────────────────────────
let tray = null;
let mainWindow = null;
let node = null;
const isDev = process.env.NODE_ENV === 'development';
const RENDERER_URL = 'http://localhost:5173';
const RENDERER_FILE = path_1.default.join(__dirname, '../renderer/index.html');
// ── Helper — avoids store.get() typing issues ─────────────────
function getConfig() {
    return store.store;
}
// ── App lifecycle ─────────────────────────────────────────────
electron_1.app.whenReady().then(() => {
    if (process.platform === 'darwin') {
        electron_1.app.dock?.hide();
    }
    createTray();
    createWindow();
    setupIPC();
    const config = getConfig();
    if (config.autoStart && config.nodeId) {
        startNode(config);
    }
});
// Electron fires window-all-closed with no arguments
electron_1.app.on('window-all-closed', () => {
    // Intentionally empty — keep alive via tray
});
electron_1.app.on('before-quit', async () => {
    if (node)
        await node.stop();
});
// ── Tray ──────────────────────────────────────────────────────
function createTray() {
    const assetsDir = electron_1.app.isPackaged
        ? path_1.default.join(process.resourcesPath, 'assets')
        : path_1.default.join(__dirname, '../../assets');
    const iconFile = process.platform === 'darwin'
        ? 'trayTemplate.png'
        : process.platform === 'win32'
            ? 'tray.ico'
            : 'tray.png';
    const iconPath = path_1.default.join(assetsDir, iconFile);
    let icon;
    try {
        icon = electron_1.nativeImage.createFromPath(iconPath);
        if (process.platform === 'darwin')
            icon.setTemplateImage(true);
    }
    catch {
        icon = electron_1.nativeImage.createEmpty();
    }
    tray = new electron_1.Tray(icon);
    tray.setToolTip('imece — idle');
    updateTrayMenu();
    tray.on('click', () => toggleWindow());
}
function updateTrayMenu(status, balance) {
    if (!tray)
        return;
    const statusLabel = status || 'Not contributing';
    const balanceLabel = balance !== undefined ? `${balance.toFixed(4)} GFT` : '—';
    const contextMenu = electron_1.Menu.buildFromTemplate([
        { label: 'imece', enabled: false, icon: electron_1.nativeImage.createEmpty() },
        { type: 'separator' },
        { label: `Status: ${statusLabel}`, enabled: false },
        { label: `Balance: ${balanceLabel}`, enabled: false },
        { type: 'separator' },
        {
            label: node?.isRunning ? 'Stop Contributing' : 'Start Contributing',
            click: () => {
                if (node?.isRunning) {
                    stopNode();
                }
                else {
                    const config = getConfig();
                    if (config.nodeId)
                        startNode(config);
                    else
                        showWindow();
                }
            },
        },
        { label: 'Open Dashboard', click: showWindow },
        { type: 'separator' },
        { label: 'Quit imece', click: () => electron_1.app.quit() },
    ]);
    tray.setContextMenu(contextMenu);
    tray.setToolTip(node?.isRunning ? `imece — ${statusLabel} · ${balanceLabel}` : 'imece — idle');
}
// ── Window ────────────────────────────────────────────────────
function createWindow() {
    const iconPath = path_1.default.join(electron_1.app.isPackaged
        ? path_1.default.join(process.resourcesPath, 'assets')
        : path_1.default.join(__dirname, '../../assets'), process.platform === 'darwin' ? 'icon.icns' : process.platform === 'win32' ? 'icon.ico' : 'icon.png');
    mainWindow = new electron_1.BrowserWindow({
        width: 960,
        height: 680,
        minWidth: 800,
        minHeight: 580,
        show: false,
        frame: true,
        icon: iconPath,
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        backgroundColor: electron_1.nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#f5f5f0',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    if (isDev) {
        mainWindow.loadURL(RENDERER_URL);
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(RENDERER_FILE);
    }
    mainWindow.on('close', (e) => {
        e.preventDefault();
        mainWindow?.hide();
    });
}
function showWindow() {
    if (!mainWindow)
        createWindow();
    mainWindow.show();
    mainWindow.focus();
    electron_1.app.dock?.show();
}
function toggleWindow() {
    if (mainWindow?.isVisible()) {
        mainWindow.hide();
        electron_1.app.dock?.hide();
    }
    else {
        showWindow();
    }
}
// ── Node management ───────────────────────────────────────────
async function startNode(config) {
    if (node?.isRunning)
        return;
    node = new node_1.ImeceNode(config);
    node.on('status', (status) => {
        mainWindow?.webContents.send('node:status', status);
        updateTrayMenu(status);
    });
    node.on('stats', (stats) => {
        mainWindow?.webContents.send('node:stats', stats);
    });
    node.on('balance', (balance) => {
        mainWindow?.webContents.send('node:balance', balance);
        updateTrayMenu(node?.status, balance);
    });
    node.on('error', (err) => {
        mainWindow?.webContents.send('node:error', err);
    });
    await node.start();
}
async function stopNode() {
    if (!node)
        return;
    await node.stop();
    updateTrayMenu();
    mainWindow?.webContents.send('node:status', 'stopped');
}
// ── IPC handlers ──────────────────────────────────────────────
function setupIPC() {
    electron_1.ipcMain.handle('config:get', () => store.store);
    electron_1.ipcMain.handle('config:set', (_e, config) => {
        store.set(config);
        return store.store;
    });
    electron_1.ipcMain.handle('node:start', async () => {
        await startNode(getConfig());
        return { ok: true };
    });
    electron_1.ipcMain.handle('node:stop', async () => {
        await stopNode();
        return { ok: true };
    });
    electron_1.ipcMain.handle('node:status', () => ({
        running: node?.isRunning ?? false,
        status: node?.status ?? 'stopped',
        stats: node?.stats ?? null,
    }));
    electron_1.ipcMain.handle('node:register', async (_e, config) => {
        try {
            const result = await registerNode(config);
            store.set({
                ...config,
                nodeId: result['id'],
                hardwareClass: result['hardware_class'],
                multiplier: result['multiplier'],
            });
            return { ok: true, node: result };
        }
        catch (err) {
            return { ok: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('inference:generate', async (_e, req) => {
        const { serverUrl } = getConfig();
        return callCoordinator(serverUrl, '/inference/generate', 'POST', req);
    });
    electron_1.ipcMain.handle('inference:models', async () => {
        const { serverUrl } = getConfig();
        return callCoordinator(serverUrl, '/inference/models', 'GET');
    });
    electron_1.ipcMain.handle('inference:cost', async (_e, params) => {
        const { serverUrl } = getConfig();
        const qs = new URLSearchParams(params).toString();
        return callCoordinator(serverUrl, `/inference/cost/estimate?${qs}`, 'GET');
    });
    electron_1.ipcMain.handle('tokens:balance', async () => {
        const { serverUrl, nodeId } = getConfig();
        if (!nodeId)
            return null;
        return callCoordinator(serverUrl, `/tokens/${nodeId}/balance`, 'GET');
    });
    electron_1.ipcMain.handle('tokens:history', async () => {
        const { serverUrl, nodeId } = getConfig();
        if (!nodeId)
            return null;
        return callCoordinator(serverUrl, `/tokens/${nodeId}/history?limit=50`, 'GET');
    });
    electron_1.ipcMain.handle('grid:states', async () => {
        const { serverUrl } = getConfig();
        return callCoordinator(serverUrl, '/grid/states', 'GET');
    });
    electron_1.ipcMain.on('shell:open', (_e, url) => {
        electron_1.shell.openExternal(url);
    });
}
// ── Coordinator API helper ────────────────────────────────────
async function callCoordinator(baseUrl, endpoint, method, body) {
    const { default: fetch } = await Promise.resolve().then(() => __importStar(require('node-fetch')));
    const res = await fetch(`${baseUrl}${endpoint}`, {
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
async function registerNode(config) {
    const hw = await detectHardware();
    const bm = await runBenchmark();
    return callCoordinator(config.serverUrl, '/nodes/register', 'POST', {
        public_key: `imece-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        hardware_profile: {
            gpu_model: hw.gpuModel,
            gpu_memory_gb: hw.gpuMemoryGb,
            cpu_model: hw.cpuModel,
            cpu_cores: hw.cpuCores,
            ram_gb: hw.ramGb,
            matmul_score: bm.matmul,
            memory_score: bm.memory,
            latency_score: bm.latency,
        },
        max_gpu_utilization: config.maxGpuUtilization,
        protocol_version: '0.1',
    });
}
async function detectHardware() {
    const os = await Promise.resolve().then(() => __importStar(require('os')));
    return {
        cpuModel: os.cpus()[0]?.model || 'Unknown',
        cpuCores: os.cpus().length,
        ramGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
        gpuModel: null,
        gpuMemoryGb: null,
    };
}
async function runBenchmark() {
    return {
        matmul: await benchMatmul(),
        memory: await benchMemory(),
        latency: await benchLatency(),
    };
}
async function benchMatmul() {
    const n = 50;
    const a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i * j) % 100));
    const b = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i + j) % 100));
    const start = Date.now();
    let r = 0;
    for (let i = 0; i < n; i++)
        for (let k = 0; k < n; k++)
            for (let j = 0; j < n; j++)
                r += a[i][k] * b[k][j];
    return Math.max(0, Math.min(1, 1 - (Date.now() - start) / 1000 / 4.9));
}
async function benchMemory() {
    const arr = new Float64Array(1000000);
    const start = Date.now();
    let s = 0;
    for (let i = 0; i < arr.length; i++)
        s += arr[i];
    return Math.max(0, Math.min(1, 1 - (Date.now() - start) / 1000 / 1.95));
}
async function benchLatency() {
    const crypto = await Promise.resolve().then(() => __importStar(require('crypto')));
    const start = Date.now();
    for (let i = 0; i < 10000; i++)
        crypto.createHash('sha256').update(String(i)).digest('hex');
    return Math.max(0, Math.min(1, 1 - (Date.now() - start) / 1000 / 1.95));
}
