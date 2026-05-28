import React, { useEffect, useState } from 'react'
import { NodeState } from '../hooks/useNode'
import { ImeceConfig } from '../lib/types'

interface Props {
  node: NodeState & { start: () => void; stop: () => void }
  config: ImeceConfig | null
}

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatBytes(gb: number) {
  if (!gb) return '—'
  return `${gb.toFixed(1)} GB`
}

export default function Contribute({ node, config }: Props) {
  const [history, setHistory] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  useEffect(() => {
    if (!config?.nodeId) return
    setLoadingHistory(true)
    window.imece.getHistory()
      .then(d => setHistory(d?.entries || []))
      .catch(() => {})
      .finally(() => setLoadingHistory(false))
  }, [config?.nodeId, node.stats?.balance])

  const stats = node.stats
  const isActive = node.running

  const passRate = stats && (stats.challengesPassed + stats.challengesFailed) > 0
    ? ((stats.challengesPassed / (stats.challengesPassed + stats.challengesFailed)) * 100).toFixed(1)
    : null

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Contribute</div>
          <div className="page-subtitle">Donate compute, earn GFT tokens</div>
        </div>

        {config?.nodeId && (
          <div style={{ display: 'flex', gap: 8 }}>
            {isActive ? (
              <button className="btn btn-danger" onClick={node.stop}>
                ◼ Stop Contributing
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={node.start}
                disabled={node.status === 'connecting'}
              >
                ▲ {node.status === 'connecting' ? 'Connecting…' : 'Start Contributing'}
              </button>
            )}
          </div>
        )}
      </div>

      {!config?.nodeId && (
        <div className="card" style={{ textAlign: 'center', padding: '32px', color: 'var(--text-2)' }}>
          <div style={{ fontSize: 24, marginBottom: 12 }}>▲</div>
          <div style={{ fontSize: 13, marginBottom: 4, color: 'var(--text-0)' }}>Node not configured</div>
          <div style={{ fontSize: 11 }}>Go to Settings to register your node</div>
        </div>
      )}

      {config?.nodeId && (
        <>
          {/* Status card */}
          <div className="card" style={{
            borderColor: isActive ? 'rgba(200,240,96,0.2)' : 'var(--border)',
            background: isActive ? 'rgba(200,240,96,0.03)' : 'var(--bg-1)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className={`dot ${isActive ? 'green pulse' : node.status === 'connecting' ? 'yellow pulse' : 'grey'}`} />
                <span style={{ fontSize: 14, fontWeight: 500 }}>
                  {isActive ? 'Contributing' : node.status === 'connecting' ? 'Connecting…' : 'Idle'}
                </span>
              </div>
              {isActive && stats && (
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  {formatUptime(stats.uptimeSeconds)}
                </span>
              )}
            </div>

            <div className="grid-3">
              <div>
                <div className="stat-label">GFT Balance</div>
                <div className="stat-value accent" style={{ marginTop: 6 }}>
                  {stats ? stats.balance.toFixed(4) : '—'}
                </div>
              </div>
              <div>
                <div className="stat-label">Total Earned</div>
                <div className="stat-value" style={{ marginTop: 6 }}>
                  {stats ? stats.totalEarned.toFixed(4) : '—'}
                </div>
              </div>
              <div>
                <div className="stat-label">Reliability</div>
                <div className="stat-value" style={{ marginTop: 6, color: (stats?.reliability ?? 1) > 0.8 ? 'var(--accent)' : 'var(--yellow)' }}>
                  {stats ? (stats.reliability * 100).toFixed(1) : '—'}<span style={{ fontSize: 13 }}>%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Hardware & shard config */}
          <div className="grid-2">
            <div className="card">
              <div className="section-title">Hardware</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <div className="kv-row">
                  <span className="kv-key">Class</span>
                  <span className="kv-val">{config.hardwareClass?.replace(/_/g, ' ') || '—'}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">Multiplier</span>
                  <span className="kv-val accent">{config.multiplier?.toFixed(3)}×</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">VRAM</span>
                  <span className="kv-val">{formatBytes(config.vramGb)}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">GPU utilization cap</span>
                  <span className="kv-val">{(config.maxGpuUtilization * 100).toFixed(0)}%</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">Mode</span>
                  <span className={`tag ${config.simulate ? 'yellow' : 'green'}`}>
                    {config.simulate ? 'simulation' : 'production'}
                  </span>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-title">Shard Configuration</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <div className="kv-row">
                  <span className="kv-key">Model</span>
                  <span className="kv-val" style={{ fontSize: 11 }}>{config.modelId?.split('/').pop()}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">Layers</span>
                  <span className="kv-val">{config.layerStart} → {config.layerEnd}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">Shard port</span>
                  <span className="kv-val mono">{config.shardPort}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">Region</span>
                  <span className="kv-val">{config.region}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">Shard status</span>
                  <span className={`tag ${stats?.shardStatus === 'registered' ? 'green' : 'grey'}`}>
                    {stats?.shardStatus || 'idle'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Challenge stats */}
          <div className="card">
            <div className="section-title">Reliability Challenges</div>
            <div className="grid-4">
              <div>
                <div className="stat-label">Passed</div>
                <div className="stat-value" style={{ color: 'var(--accent)', marginTop: 6 }}>
                  {stats?.challengesPassed ?? 0}
                </div>
              </div>
              <div>
                <div className="stat-label">Failed</div>
                <div className="stat-value" style={{ color: 'var(--red)', marginTop: 6 }}>
                  {stats?.challengesFailed ?? 0}
                </div>
              </div>
              <div>
                <div className="stat-label">Pass rate</div>
                <div className="stat-value" style={{ marginTop: 6 }}>
                  {passRate ? `${passRate}%` : '—'}
                </div>
              </div>
              <div>
                <div className="stat-label">Reconnects</div>
                <div className="stat-value" style={{ marginTop: 6 }}>
                  {stats?.reconnectAttempts ?? 0}
                </div>
              </div>
            </div>
          </div>

          {/* Ledger history */}
          <div className="card">
            <div className="section-title" style={{ marginBottom: 12 }}>Recent Ledger Entries</div>
            {loadingHistory ? (
              <div style={{ color: 'var(--text-2)', fontSize: 12, padding: '8px 0' }}>Loading…</div>
            ) : history.length === 0 ? (
              <div style={{ color: 'var(--text-2)', fontSize: 12, padding: '8px 0' }}>
                No ledger entries yet. Start contributing to earn GFT.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {history.slice(-20).reverse().map((entry: any) => (
                  <div key={entry.id} className="kv-row">
                    <div style={{ display: 'flex', align: 'center', gap: 8, flex: 1 }}>
                      <span className={`tag ${entry.event_type === 'issuance' ? 'green' : entry.event_type === 'redemption' ? 'blue' : 'grey'}`}>
                        {entry.event_type}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <span className="mono" style={{
                      fontSize: 12,
                      color: entry.amount > 0 ? 'var(--accent)' : 'var(--red)',
                    }}>
                      {entry.amount > 0 ? '+' : ''}{entry.amount.toFixed(4)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
