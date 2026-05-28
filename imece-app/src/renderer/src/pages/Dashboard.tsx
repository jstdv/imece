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

function ReliabilityBar({ value }: { value: number }) {
  const pct = ((value - 0.5) / 0.5) * 100
  const color = pct > 80 ? 'var(--accent)' : pct > 50 ? 'var(--yellow)' : 'var(--red)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        flex: 1, height: 4, background: 'var(--bg-3)',
        borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.5s' }} />
      </div>
      <span className="mono" style={{ fontSize: 11, color, minWidth: 40, textAlign: 'right' }}>
        {value.toFixed(4)}
      </span>
    </div>
  )
}

export default function Dashboard({ node, config }: Props) {
  const [gridStates, setGridStates] = useState<any[]>([])

  useEffect(() => {
    if (!config?.serverUrl) return
    window.imece.getGridStates().then(d => setGridStates(d?.regions || [])).catch(() => {})
    const interval = setInterval(() => {
      window.imece.getGridStates().then(d => setGridStates(d?.regions || [])).catch(() => {})
    }, 30_000)
    return () => clearInterval(interval)
  }, [config?.serverUrl])

  const stats = node.stats
  const passRate = stats && (stats.challengesPassed + stats.challengesFailed) > 0
    ? (stats.challengesPassed / (stats.challengesPassed + stats.challengesFailed) * 100).toFixed(1)
    : '—'

  const statusTag = () => {
    if (node.running) return <span className="tag green">Contributing</span>
    if (node.status === 'connecting') return <span className="tag yellow">Connecting</span>
    if (node.status === 'error') return <span className="tag red">Error</span>
    return <span className="tag grey">Idle</span>
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">
            {config?.nodeId
              ? `Node ${config.nodeId.slice(0, 8)}… · ${config.hardwareClass || 'unknown'} · ${config.multiplier?.toFixed(3)}×`
              : 'No node configured — go to Settings to get started'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {statusTag()}
          {config?.nodeId && (
            node.running
              ? <button className="btn btn-ghost" onClick={node.stop}>Stop</button>
              : <button className="btn btn-primary" onClick={node.start}
                  disabled={node.status === 'connecting'}>
                  Start Contributing
                </button>
          )}
        </div>
      </div>

      {/* Top stats */}
      <div className="grid-4">
        <div className="stat-card">
          <div className="stat-label">GFT Balance</div>
          <div className="stat-value accent">{stats ? stats.balance.toFixed(4) : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Earned</div>
          <div className="stat-value">{stats ? stats.totalEarned.toFixed(4) : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Uptime</div>
          <div className="stat-value small mono">
            {stats ? formatUptime(stats.uptimeSeconds) : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Multiplier</div>
          <div className="stat-value">{config?.multiplier?.toFixed(3) ?? '—'}<span style={{ fontSize: 13, color: 'var(--text-2)' }}>×</span></div>
        </div>
      </div>

      {/* Reliability + challenges */}
      <div className="grid-2">
        <div className="card">
          <div className="section-title">Reliability Factor</div>
          <ReliabilityBar value={stats?.reliability ?? 1.0} />
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div className="kv-row">
              <span className="kv-key">Challenges passed</span>
              <span className="kv-val" style={{ color: 'var(--accent)' }}>{stats?.challengesPassed ?? 0}</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">Challenges failed</span>
              <span className="kv-val" style={{ color: 'var(--red)' }}>{stats?.challengesFailed ?? 0}</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">Pass rate</span>
              <span className="kv-val">{passRate}%</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">Reconnect attempts</span>
              <span className="kv-val">{stats?.reconnectAttempts ?? 0}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-title">Shard Status</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div className="kv-row">
              <span className="kv-key">Shard</span>
              <span className={`tag ${stats?.shardStatus === 'registered' ? 'green' : stats?.shardStatus === 'registering' ? 'yellow' : 'grey'}`}>
                {stats?.shardStatus ?? 'idle'}
              </span>
            </div>
            <div className="kv-row">
              <span className="kv-key">Pipeline</span>
              <span className={`tag ${stats?.pipelineStatus === 'complete' ? 'green' : 'yellow'}`}>
                {stats?.pipelineStatus ?? 'unknown'}
              </span>
            </div>
            <div className="kv-row">
              <span className="kv-key">Model</span>
              <span className="kv-val" style={{ fontSize: 11 }}>{config?.modelId?.split('/').pop() ?? '—'}</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">Layers</span>
              <span className="kv-val">{config ? `${config.layerStart} → ${config.layerEnd}` : '—'}</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">Region</span>
              <span className="kv-val">{config?.region ?? '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid states */}
      {gridStates.length > 0 && (
        <div className="card">
          <div className="section-title">Grid States</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {gridStates.slice(0, 8).map((g: any) => (
              <div className="kv-row" key={g.region}>
                <span className="kv-key mono" style={{ minWidth: 60 }}>{g.region}</span>
                <div style={{ flex: 1, margin: '0 16px' }}>
                  <div style={{ height: 3, background: 'var(--bg-3)', borderRadius: 2 }}>
                    <div style={{
                      width: `${g.grid_score * 100}%`, height: '100%',
                      background: g.grid_score > 0.7 ? 'var(--accent)' : g.grid_score > 0.4 ? 'var(--yellow)' : 'var(--red)',
                      borderRadius: 2,
                    }} />
                  </div>
                </div>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-1)', minWidth: 36, textAlign: 'right' }}>
                  {(g.grid_score * 100).toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
