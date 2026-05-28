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

export const defaultConfig: ImeceConfig = {
  serverUrl: 'http://192.168.x.x:8000',
  nodeId: null,
  hardwareClass: null,
  multiplier: 1.0,
  region: 'US-NY',
  modelId: 'meta-llama/Meta-Llama-3-8B',
  layerStart: 0,
  layerEnd: 15,
  shardPort: 8010,
  maxGpuUtilization: 0.8,
  autoStart: false,
  simulate: true,
  vramGb: 0,
}
