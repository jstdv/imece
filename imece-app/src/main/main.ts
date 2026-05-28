import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  shell,
  nativeTheme,
} from 'electron'
import path from 'path'
import Store from 'electron-store'
import { ImeceNode } from './node'
import { ImeceConfig, defaultConfig } from './config'

// ── Store ─────────────────────────────────────────────────────
const store = new Store<ImeceConfig>({ defaults: defaultConfig })

// ── State ─────────────────────────────────────────────────────
let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
let node: ImeceNode | null = null

const isDev = process.env.NODE_ENV === 'development'
const RENDERER_URL = 'http://localhost:5173'
const RENDERER_FILE = path.join(__dirname, '../renderer/index.html')

// ── Helper — avoids store.get() typing issues ─────────────────
function getConfig(): ImeceConfig {
  return store.store as ImeceConfig
}

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock?.hide()
  }

  createTray()
  createWindow()
  setupIPC()

  const config = getConfig()
  if (config.autoStart && config.nodeId) {
    startNode(config)
  }
})

// Electron fires window-all-closed with no arguments
app.on('window-all-closed', () => {
  // Intentionally empty — keep alive via tray
})

app.on('before-quit', async () => {
  if (node) await node.stop()
})

// ── Tray ──────────────────────────────────────────────────────
function createTray() {
  const assetsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets')

  const iconFile = process.platform === 'darwin'
    ? 'trayTemplate.png'
    : process.platform === 'win32'
      ? 'tray.ico'
      : 'tray.png'

  const iconPath = path.join(assetsDir, iconFile)

  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(iconPath)
    if (process.platform === 'darwin') icon.setTemplateImage(true)
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('imece — idle')
  updateTrayMenu()

  tray.on('click', () => toggleWindow())
}

function updateTrayMenu(status?: string, balance?: number) {
  if (!tray) return

  const statusLabel = status || 'Not contributing'
  const balanceLabel = balance !== undefined ? `${balance.toFixed(4)} GFT` : '—'

  const contextMenu = Menu.buildFromTemplate([
    { label: 'imece', enabled: false, icon: nativeImage.createEmpty() },
    { type: 'separator' },
    { label: `Status: ${statusLabel}`, enabled: false },
    { label: `Balance: ${balanceLabel}`, enabled: false },
    { type: 'separator' },
    {
      label: node?.isRunning ? 'Stop Contributing' : 'Start Contributing',
      click: () => {
        if (node?.isRunning) {
          stopNode()
        } else {
          const config = getConfig()
          if (config.nodeId) startNode(config)
          else showWindow()
        }
      },
    },
    { label: 'Open Dashboard', click: showWindow },
    { type: 'separator' },
    { label: 'Quit imece', click: () => app.quit() },
  ])

  tray.setContextMenu(contextMenu)
  tray.setToolTip(node?.isRunning ? `imece — ${statusLabel} · ${balanceLabel}` : 'imece — idle')
}

// ── Window ────────────────────────────────────────────────────
function createWindow() {
  const iconPath = path.join(
    app.isPackaged
      ? path.join(process.resourcesPath, 'assets')
      : path.join(__dirname, '../../assets'),
    process.platform === 'darwin' ? 'icon.icns' : process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  )

  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 800,
    minHeight: 580,
    show: false,
    frame: true,
    icon: iconPath,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#f5f5f0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL(RENDERER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(RENDERER_FILE)
  }

  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })
}

function showWindow() {
  if (!mainWindow) createWindow()
  mainWindow!.show()
  mainWindow!.focus()
  app.dock?.show()
}

function toggleWindow() {
  if (mainWindow?.isVisible()) {
    mainWindow.hide()
    app.dock?.hide()
  } else {
    showWindow()
  }
}

// ── Node management ───────────────────────────────────────────
async function startNode(config: ImeceConfig) {
  if (node?.isRunning) return

  node = new ImeceNode(config)

  node.on('status', (status: string) => {
    mainWindow?.webContents.send('node:status', status)
    updateTrayMenu(status)
  })

  node.on('stats', (stats: object) => {
    mainWindow?.webContents.send('node:stats', stats)
  })

  node.on('balance', (balance: number) => {
    mainWindow?.webContents.send('node:balance', balance)
    updateTrayMenu(node?.status, balance)
  })

  node.on('error', (err: string) => {
    mainWindow?.webContents.send('node:error', err)
  })

  await node.start()
}

async function stopNode() {
  if (!node) return
  await node.stop()
  updateTrayMenu()
  mainWindow?.webContents.send('node:status', 'stopped')
}

// ── IPC handlers ──────────────────────────────────────────────
function setupIPC() {
  ipcMain.handle('config:get', () => store.store)
  ipcMain.handle('config:set', (_e, config: Partial<ImeceConfig>) => {
    store.set(config as any)
    return store.store
  })

  ipcMain.handle('node:start', async () => {
    await startNode(getConfig())
    return { ok: true }
  })

  ipcMain.handle('node:stop', async () => {
    await stopNode()
    return { ok: true }
  })

  ipcMain.handle('node:status', () => ({
    running: node?.isRunning ?? false,
    status: node?.status ?? 'stopped',
    stats: node?.stats ?? null,
  }))

  ipcMain.handle('node:register', async (_e, config: ImeceConfig) => {
    try {
      const result = await registerNode(config) as Record<string, any>
      store.set({
        ...config,
        nodeId:        result['id'],
        hardwareClass: result['hardware_class'],
        multiplier:    result['multiplier'],
      } as any)
      return { ok: true, node: result }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('inference:generate', async (_e, req: object) => {
    const { serverUrl } = getConfig()
    return callCoordinator(serverUrl, '/inference/generate', 'POST', req)
  })

  ipcMain.handle('inference:models', async () => {
    const { serverUrl } = getConfig()
    return callCoordinator(serverUrl, '/inference/models', 'GET')
  })

  ipcMain.handle('inference:cost', async (_e, params: { model_id: string; max_new_tokens: number; precision: string }) => {
    const { serverUrl } = getConfig()
    const qs = new URLSearchParams(params as any).toString()
    return callCoordinator(serverUrl, `/inference/cost/estimate?${qs}`, 'GET')
  })

  ipcMain.handle('tokens:balance', async () => {
    const { serverUrl, nodeId } = getConfig()
    if (!nodeId) return null
    return callCoordinator(serverUrl, `/tokens/${nodeId}/balance`, 'GET')
  })

  ipcMain.handle('tokens:history', async () => {
    const { serverUrl, nodeId } = getConfig()
    if (!nodeId) return null
    return callCoordinator(serverUrl, `/tokens/${nodeId}/history?limit=50`, 'GET')
  })

  ipcMain.handle('grid:states', async () => {
    const { serverUrl } = getConfig()
    return callCoordinator(serverUrl, '/grid/states', 'GET')
  })

  ipcMain.on('shell:open', (_e, url: string) => {
    shell.openExternal(url)
  })
}

// ── Coordinator API helper ────────────────────────────────────
async function callCoordinator(
  baseUrl: string,
  endpoint: string,
  method: string,
  body?: object
): Promise<unknown> {
  const { default: fetch } = await import('node-fetch')
  const res = await fetch(`${baseUrl}${endpoint}`, {
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

async function registerNode(config: ImeceConfig): Promise<unknown> {
  const hw = await detectHardware()
  const bm = await runBenchmark()
  return callCoordinator(config.serverUrl, '/nodes/register', 'POST', {
    public_key: `imece-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    hardware_profile: {
      gpu_model:      hw.gpuModel,
      gpu_memory_gb:  hw.gpuMemoryGb,
      cpu_model:      hw.cpuModel,
      cpu_cores:      hw.cpuCores,
      ram_gb:         hw.ramGb,
      matmul_score:   bm.matmul,
      memory_score:   bm.memory,
      latency_score:  bm.latency,
    },
    max_gpu_utilization: config.maxGpuUtilization,
    protocol_version: '0.1',
  })
}

async function detectHardware() {
  const os = await import('os')
  return {
    cpuModel:    os.cpus()[0]?.model || 'Unknown',
    cpuCores:    os.cpus().length,
    ramGb:       Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    gpuModel:    null as string | null,
    gpuMemoryGb: null as number | null,
  }
}

async function runBenchmark(): Promise<{ matmul: number; memory: number; latency: number }> {
  return {
    matmul:  await benchMatmul(),
    memory:  await benchMemory(),
    latency: await benchLatency(),
  }
}

async function benchMatmul(): Promise<number> {
  const n = 50
  const a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i * j) % 100))
  const b = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i + j) % 100))
  const start = Date.now()
  let r = 0
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++)
      for (let j = 0; j < n; j++) r += a[i][k] * b[k][j]
  return Math.max(0, Math.min(1, 1 - (Date.now() - start) / 1000 / 4.9))
}

async function benchMemory(): Promise<number> {
  const arr = new Float64Array(1_000_000)
  const start = Date.now()
  let s = 0
  for (let i = 0; i < arr.length; i++) s += arr[i]
  return Math.max(0, Math.min(1, 1 - (Date.now() - start) / 1000 / 1.95))
}

async function benchLatency(): Promise<number> {
  const crypto = await import('crypto')
  const start = Date.now()
  for (let i = 0; i < 10_000; i++) crypto.createHash('sha256').update(String(i)).digest('hex')
  return Math.max(0, Math.min(1, 1 - (Date.now() - start) / 1000 / 1.95))
}