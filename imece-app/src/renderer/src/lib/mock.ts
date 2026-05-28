/**
 * Browser dev mock — only active when window.imece is not injected by Electron.
 * Provides realistic stub data so all four pages render without a running coordinator.
 */

import { ImeceConfig, NodeStats } from './types'

const mockConfig: ImeceConfig = {
  serverUrl: 'http://localhost:8000',
  nodeId: 'dev-node-0000-0000-0000-000000000001',
  hardwareClass: 'mid_consumer_gpu',
  multiplier: 1.325,
  region: 'US-NY',
  modelId: 'meta-llama/Meta-Llama-3-8B',
  layerStart: 0,
  layerEnd: 15,
  shardPort: 8010,
  maxGpuUtilization: 0.8,
  autoStart: false,
  simulate: true,
  vramGb: 8,
}

const mockStats: NodeStats = {
  challengesPassed: 12,
  challengesFailed: 1,
  reliability: 0.9812,
  balance: 47.2341,
  totalEarned: 52.1089,
  pipelineStatus: 'complete',
  shardStatus: 'registered',
  reconnectAttempts: 0,
  uptimeSeconds: 3724,
}

const mockModels = {
  models: [
    { model_id: 'meta-llama/Meta-Llama-3-8B',  friendly_name: 'llama3-8b',    total_layers: 32, min_nodes: 1, optimal_nodes: 2, pipeline_available: true,  registry: { online: 2, offline: 0, layers_covered: 32 } },
    { model_id: 'meta-llama/Meta-Llama-3-70B', friendly_name: 'llama3-70b',   total_layers: 80, min_nodes: 2, optimal_nodes: 4, pipeline_available: false, registry: { online: 1, offline: 0, layers_covered: 40 } },
    { model_id: 'mistralai/Mistral-7B-v0.1',   friendly_name: 'mistral-7b',   total_layers: 32, min_nodes: 1, optimal_nodes: 2, pipeline_available: true,  registry: { online: 1, offline: 0, layers_covered: 32 } },
  ]
}

const mockGridStates = {
  regions: [
    { region: 'NO',    load_factor: 0.35, carbon_intensity: 0.05, renewable_fraction: 0.95, grid_score: 0.892 },
    { region: 'FR',    load_factor: 0.50, carbon_intensity: 0.10, renewable_fraction: 0.75, grid_score: 0.810 },
    { region: 'US-WA', load_factor: 0.40, carbon_intensity: 0.10, renewable_fraction: 0.80, grid_score: 0.800 },
    { region: 'GB',    load_factor: 0.60, carbon_intensity: 0.30, renewable_fraction: 0.55, grid_score: 0.650 },
    { region: 'DE',    load_factor: 0.55, carbon_intensity: 0.35, renewable_fraction: 0.50, grid_score: 0.620 },
    { region: 'US-CA', load_factor: 0.50, carbon_intensity: 0.25, renewable_fraction: 0.60, grid_score: 0.670 },
    { region: 'US-NY', load_factor: 0.55, carbon_intensity: 0.30, renewable_fraction: 0.45, grid_score: 0.594 },
    { region: 'JP',    load_factor: 0.65, carbon_intensity: 0.50, renewable_fraction: 0.22, grid_score: 0.433 },
    { region: 'AU',    load_factor: 0.60, carbon_intensity: 0.45, renewable_fraction: 0.30, grid_score: 0.442 },
    { region: 'US-TX', load_factor: 0.70, carbon_intensity: 0.55, renewable_fraction: 0.25, grid_score: 0.320 },
    { region: 'SG',    load_factor: 0.70, carbon_intensity: 0.60, renewable_fraction: 0.10, grid_score: 0.240 },
  ]
}

const mockHistory = {
  entries: Array.from({ length: 15 }, (_, i) => ({
    id: `entry-${i}`,
    event_type: i % 4 === 0 ? 'redemption' : 'issuance',
    amount: i % 4 === 0 ? -(Math.random() * 2).toFixed(4) : (Math.random() * 5).toFixed(4),
    timestamp: new Date(Date.now() - i * 3_600_000).toISOString(),
  }))
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const noop = (..._args: any[]) => {}
const resolved = (val: any) => () => Promise.resolve(val)

export function installBrowserMock() {
  if (typeof window === 'undefined') return
  if ((window as any).imece) return  // already injected by Electron preload

  let _config = { ...mockConfig }
  const listeners: Record<string, Function[]> = {}

  const emit = (event: string, data: any) => {
    ;(listeners[event] || []).forEach(cb => cb(data))
  }

  // Simulate stats updating every second in dev mode
  let uptimeTick = mockStats.uptimeSeconds
  setInterval(() => {
    uptimeTick++
    emit('node:stats', { ...mockStats, uptimeSeconds: uptimeTick })
  }, 1000)

  ;(window as any).imece = {
    getConfig: resolved(_config),
    setConfig: (updates: Partial<ImeceConfig>) => {
      _config = { ..._config, ...updates }
      return Promise.resolve(_config)
    },

    startNode: () => { emit('node:status', 'contributing'); return Promise.resolve({ ok: true }) },
    stopNode:  () => { emit('node:status', 'stopped');      return Promise.resolve({ ok: true }) },
    getNodeStatus: () => Promise.resolve({ running: false, status: 'stopped', stats: mockStats }),
    registerNode: () => Promise.resolve({ ok: true, node: { id: mockConfig.nodeId, hardware_class: mockConfig.hardwareClass, multiplier: mockConfig.multiplier } }),

    generate: (_req: any) => new Promise(resolve =>
      setTimeout(() => resolve({
        text: 'This is a simulated response from the browser dev mock. In production this routes through the distributed shard pipeline or Ollama fallback.',
        tokens: 32,
        input_tokens: 8,
        gft_deducted: 0.0225,
        new_balance: mockStats.balance - 0.0225,
        backend: 'distributed',
        pipeline: ['node-a', 'node-b'],
        latency_ms: 312,
        ledger_ref: 'dev-ledger-ref',
        confirmed_at: new Date().toISOString(),
        request_id: 'dev-req',
      }), 1200)
    ),
    getModels:    resolved(mockModels),
    estimateCost: resolved({ estimated_gft: 0.0225 }),

    getBalance: resolved({ balance: mockStats.balance, total_earned: mockStats.totalEarned, total_spent: 4.8748 }),
    getHistory: resolved(mockHistory),

    getGridStates: resolved(mockGridStates),

    onNodeStatus: (cb: Function) => {
      listeners['node:status'] = [...(listeners['node:status'] || []), cb]
      return () => { listeners['node:status'] = (listeners['node:status'] || []).filter(f => f !== cb) }
    },
    onNodeStats: (cb: Function) => {
      listeners['node:stats'] = [...(listeners['node:stats'] || []), cb]
      return () => { listeners['node:stats'] = (listeners['node:stats'] || []).filter(f => f !== cb) }
    },
    onNodeBalance: (cb: Function) => {
      listeners['node:balance'] = [...(listeners['node:balance'] || []), cb]
      return () => { listeners['node:balance'] = (listeners['node:balance'] || []).filter(f => f !== cb) }
    },
    onNodeError: (cb: Function) => {
      listeners['node:error'] = [...(listeners['node:error'] || []), cb]
      return () => { listeners['node:error'] = (listeners['node:error'] || []).filter(f => f !== cb) }
    },

    openExternal: (url: string) => window.open(url, '_blank'),
    platform: 'browser',
  }

  console.info('[imece] Browser dev mock installed — window.imece is simulated')
}
