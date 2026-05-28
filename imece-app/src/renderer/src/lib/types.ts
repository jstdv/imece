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

export interface ImeceConfig {
  serverUrl: string
  nodeId: string | null
  hardwareClass: string | null
  multiplier: number
  region: string
  modelId: string
  layerStart: number
  layerEnd: number
  shardPort: number
  maxGpuUtilization: number
  autoStart: boolean
  simulate: boolean
  vramGb: number
}

export interface ImeceAPI {
  getConfig: () => Promise<ImeceConfig>
  setConfig: (config: Partial<ImeceConfig>) => Promise<ImeceConfig>
  startNode: () => Promise<{ ok: boolean }>
  stopNode: () => Promise<{ ok: boolean }>
  getNodeStatus: () => Promise<{ running: boolean; status: string; stats: NodeStats | null }>
  registerNode: (config: ImeceConfig) => Promise<{ ok: boolean; node?: any; error?: string }>
  generate: (req: object) => Promise<any>
  getModels: () => Promise<any>
  estimateCost: (params: { model_id: string; max_new_tokens: number; precision: string }) => Promise<any>
  getBalance: () => Promise<any>
  getHistory: () => Promise<any>
  getGridStates: () => Promise<any>
  onNodeStatus: (cb: (status: string) => void) => () => void
  onNodeStats: (cb: (stats: NodeStats) => void) => () => void
  onNodeBalance: (cb: (balance: number) => void) => () => void
  onNodeError: (cb: (error: string) => void) => () => void
  openExternal: (url: string) => void
  platform: string
}

declare global {
  interface Window {
    imece: ImeceAPI
  }
}
