"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('imece', {
    // Config
    getConfig: () => electron_1.ipcRenderer.invoke('config:get'),
    setConfig: (config) => electron_1.ipcRenderer.invoke('config:set', config),
    // Node control
    startNode: () => electron_1.ipcRenderer.invoke('node:start'),
    stopNode: () => electron_1.ipcRenderer.invoke('node:stop'),
    getNodeStatus: () => electron_1.ipcRenderer.invoke('node:status'),
    registerNode: (config) => electron_1.ipcRenderer.invoke('node:register', config),
    // Inference
    generate: (req) => electron_1.ipcRenderer.invoke('inference:generate', req),
    getModels: () => electron_1.ipcRenderer.invoke('inference:models'),
    estimateCost: (params) => electron_1.ipcRenderer.invoke('inference:cost', params),
    // Tokens
    getBalance: () => electron_1.ipcRenderer.invoke('tokens:balance'),
    getHistory: () => electron_1.ipcRenderer.invoke('tokens:history'),
    // Grid
    getGridStates: () => electron_1.ipcRenderer.invoke('grid:states'),
    // Event listeners
    onNodeStatus: (cb) => {
        electron_1.ipcRenderer.on('node:status', (_e, status) => cb(status));
        return () => electron_1.ipcRenderer.removeAllListeners('node:status');
    },
    onNodeStats: (cb) => {
        electron_1.ipcRenderer.on('node:stats', (_e, stats) => cb(stats));
        return () => electron_1.ipcRenderer.removeAllListeners('node:stats');
    },
    onNodeBalance: (cb) => {
        electron_1.ipcRenderer.on('node:balance', (_e, balance) => cb(balance));
        return () => electron_1.ipcRenderer.removeAllListeners('node:balance');
    },
    onNodeError: (cb) => {
        electron_1.ipcRenderer.on('node:error', (_e, error) => cb(error));
        return () => electron_1.ipcRenderer.removeAllListeners('node:error');
    },
    // Shell
    openExternal: (url) => electron_1.ipcRenderer.send('shell:open', url),
    // Platform
    platform: process.platform,
});
