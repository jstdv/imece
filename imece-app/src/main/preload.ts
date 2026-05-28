import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('imece', {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: object) => ipcRenderer.invoke('config:set', config),

  // Node control
  startNode: () => ipcRenderer.invoke('node:start'),
  stopNode: () => ipcRenderer.invoke('node:stop'),
  getNodeStatus: () => ipcRenderer.invoke('node:status'),
  registerNode: (config: object) => ipcRenderer.invoke('node:register', config),

  // Inference
  generate: (req: object) => ipcRenderer.invoke('inference:generate', req),
  getModels: () => ipcRenderer.invoke('inference:models'),
  estimateCost: (params: object) => ipcRenderer.invoke('inference:cost', params),

  // Tokens
  getBalance: () => ipcRenderer.invoke('tokens:balance'),
  getHistory: () => ipcRenderer.invoke('tokens:history'),

  // Grid
  getGridStates: () => ipcRenderer.invoke('grid:states'),

  // Event listeners
  onNodeStatus: (cb: (status: string) => void) => {
    ipcRenderer.on('node:status', (_e, status) => cb(status))
    return () => ipcRenderer.removeAllListeners('node:status')
  },
  onNodeStats: (cb: (stats: object) => void) => {
    ipcRenderer.on('node:stats', (_e, stats) => cb(stats))
    return () => ipcRenderer.removeAllListeners('node:stats')
  },
  onNodeBalance: (cb: (balance: number) => void) => {
    ipcRenderer.on('node:balance', (_e, balance) => cb(balance))
    return () => ipcRenderer.removeAllListeners('node:balance')
  },
  onNodeError: (cb: (error: string) => void) => {
    ipcRenderer.on('node:error', (_e, error) => cb(error))
    return () => ipcRenderer.removeAllListeners('node:error')
  },

  // Shell
  openExternal: (url: string) => ipcRenderer.send('shell:open', url),

  // Platform
  platform: process.platform,
})
