import React, { useState, useEffect } from 'react'
import { useConfig } from '../hooks/useConfig'
import { ImeceConfig } from '../lib/types'

const REGIONS = ['NO','FR','GB','DE','US-CA','US-WA','US-NY','US-TX','JP','AU','SG','TR']
const MODELS = [
  { id: 'meta-llama/Meta-Llama-3-8B',  label: 'LLaMA 3 8B',  layers: 32 },
  { id: 'meta-llama/Meta-Llama-3-70B', label: 'LLaMA 3 70B', layers: 80 },
  { id: 'mistralai/Mistral-7B-v0.1',   label: 'Mistral 7B',  layers: 32 },
  { id: 'mistralai/Mixtral-8x7B-v0.1', label: 'Mixtral 8x7B',layers: 32 },
]

interface Props {
  config: ImeceConfig | null
  onNavigate: (page: any) => void
}

type Tab = 'node' | 'shard' | 'advanced'

export default function Settings({ config: configProp, onNavigate }: Props) {
  const { config, setConfig } = useConfig()
  const [tab, setTab] = useState<Tab>('node')
  const [form, setForm] = useState<Partial<ImeceConfig>>({})
  const [registering, setRegistering] = useState(false)
  const [registerResult, setRegisterResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config) setForm(config)
  }, [config])

  const update = (key: keyof ImeceConfig, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const save = async () => {
    await setConfig(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const register = async () => {
    if (!form.serverUrl) return
    setRegistering(true)
    setRegisterResult(null)
    try {
      const merged = { ...config, ...form } as ImeceConfig
      const res = await window.imece.registerNode(merged)
      if (res.ok) {
        setRegisterResult({ ok: true, message: `Registered · ${res.node?.hardware_class} · ${res.node?.multiplier?.toFixed(3)}×` })
        await setConfig({
          ...form,
          nodeId: res.node?.id,
          hardwareClass: res.node?.hardware_class,
          multiplier: res.node?.multiplier,
        })
      } else {
        setRegisterResult({ ok: false, message: res.error || 'Registration failed' })
      }
    } catch (err: any) {
      setRegisterResult({ ok: false, message: err.message })
    } finally {
      setRegistering(false)
    }
  }

  const selectedModel = MODELS.find(m => m.id === form.modelId)

  const TABS: { id: Tab; label: string }[] = [
    { id: 'node',     label: 'Node' },
    { id: 'shard',    label: 'Shard' },
    { id: 'advanced', label: 'Advanced' },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Configure your node and shard assignment</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={save}>
            {saved ? '✓ Saved' : 'Save'}
          </button>
          {!config?.nodeId ? (
            <button className="btn btn-primary" onClick={register} disabled={registering || !form.serverUrl}>
              {registering ? 'Registering…' : 'Register Node'}
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={register} disabled={registering}>
              {registering ? 'Re-registering…' : 'Re-register'}
            </button>
          )}
        </div>
      </div>

      {/* Registration result */}
      {registerResult && (
        <div style={{
          padding: '10px 14px',
          borderRadius: 'var(--radius)',
          background: registerResult.ok ? 'var(--accent-bg)' : 'var(--red-bg)',
          border: `1px solid ${registerResult.ok ? 'rgba(200,240,96,0.2)' : 'rgba(255,95,82,0.2)'}`,
          color: registerResult.ok ? 'var(--accent)' : 'var(--red)',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
        }}>
          {registerResult.message}
        </div>
      )}

      {/* Current node */}
      {config?.nodeId && (
        <div className="card" style={{ borderColor: 'rgba(200,240,96,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div className="section-title">Registered Node</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-1)', marginTop: 4 }}>
                {config.nodeId}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="tag green">{config.hardwareClass?.replace(/_/g, ' ')}</span>
              <span className="tag blue">{config.multiplier?.toFixed(3)}×</span>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              color: tab === t.id ? 'var(--text-0)' : 'var(--text-2)',
              borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
              borderRadius: 0,
              fontSize: 12,
              fontWeight: tab === t.id ? 600 : 400,
              marginBottom: -1,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Node */}
      {tab === 'node' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-row">
            <label className="form-label">Coordinator URL</label>
            <input
              type="url"
              value={form.serverUrl || ''}
              onChange={e => update('serverUrl', e.target.value)}
              placeholder="http://localhost:8000"
            />
            <div className="form-hint">The imece coordination layer endpoint</div>
          </div>

          <div className="form-row">
            <label className="form-label">Region</label>
            <select value={form.region || 'US-NY'} onChange={e => update('region', e.target.value)}>
              {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <div className="form-hint">Your geographic region for grid-aware scheduling</div>
          </div>

          <div className="form-row">
            <label className="form-label">Max GPU Utilization</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="range"
                min={0.1} max={1.0} step={0.05}
                value={form.maxGpuUtilization || 0.8}
                onChange={e => update('maxGpuUtilization', parseFloat(e.target.value))}
                style={{ flex: 1, padding: 0, border: 'none', background: 'transparent' }}
              />
              <span className="mono" style={{ fontSize: 12, minWidth: 36 }}>
                {((form.maxGpuUtilization || 0.8) * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          <div className="form-row">
            <label className="form-label">Auto-start on launch</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                id="autostart"
                checked={form.autoStart || false}
                onChange={e => update('autoStart', e.target.checked)}
                style={{ width: 'auto' }}
              />
              <label htmlFor="autostart" style={{ fontSize: 12, color: 'var(--text-1)', cursor: 'pointer' }}>
                Start contributing automatically when imece opens
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Shard */}
      {tab === 'shard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-row">
            <label className="form-label">Model</label>
            <select value={form.modelId || ''} onChange={e => update('modelId', e.target.value)}>
              {MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label} ({m.layers} layers)</option>
              ))}
            </select>
          </div>

          <div className="form-grid">
            <div className="form-row">
              <label className="form-label">Layer Start</label>
              <input
                type="number"
                min={0}
                max={selectedModel ? selectedModel.layers - 1 : 79}
                value={form.layerStart ?? 0}
                onChange={e => update('layerStart', parseInt(e.target.value))}
              />
            </div>
            <div className="form-row">
              <label className="form-label">Layer End</label>
              <input
                type="number"
                min={0}
                max={selectedModel ? selectedModel.layers - 1 : 79}
                value={form.layerEnd ?? 15}
                onChange={e => update('layerEnd', parseInt(e.target.value))}
              />
            </div>
          </div>
          {selectedModel && (
            <div className="form-hint">
              {form.layerEnd! - form.layerStart! + 1} of {selectedModel.layers} layers ·{' '}
              {(((form.layerEnd! - form.layerStart! + 1) / selectedModel.layers) * 100).toFixed(1)}% of model
            </div>
          )}

          <div className="form-row">
            <label className="form-label">Shard Port</label>
            <input
              type="number"
              value={form.shardPort || 8010}
              onChange={e => update('shardPort', parseInt(e.target.value))}
            />
            <div className="form-hint">Port for the local activation server</div>
          </div>

          <div className="form-row">
            <label className="form-label">VRAM Available (GB)</label>
            <input
              type="number"
              step={0.5}
              min={0}
              value={form.vramGb || 0}
              onChange={e => update('vramGb', parseFloat(e.target.value))}
            />
          </div>

          <div className="form-row">
            <label className="form-label">Simulation Mode</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                id="simulate"
                checked={form.simulate !== false}
                onChange={e => update('simulate', e.target.checked)}
                style={{ width: 'auto' }}
              />
              <label htmlFor="simulate" style={{ fontSize: 12, color: 'var(--text-1)', cursor: 'pointer' }}>
                Simulate activations (no real model weights required)
              </label>
            </div>
            {!form.simulate && (
              <div className="form-hint" style={{ color: 'var(--yellow)' }}>
                Production mode requires torch + transformers installed
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Advanced */}
      {tab === 'advanced' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="section-title">Node Identity</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div className="kv-row">
                <span className="kv-key">Node ID</span>
                <span className="mono kv-val" style={{ fontSize: 10 }}>
                  {config?.nodeId || '—'}
                </span>
              </div>
              <div className="kv-row">
                <span className="kv-key">Hardware class</span>
                <span className="kv-val">{config?.hardwareClass || '—'}</span>
              </div>
              <div className="kv-row">
                <span className="kv-key">Multiplier</span>
                <span className="kv-val">{config?.multiplier?.toFixed(4) || '—'}×</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title">Links</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {[
                { label: 'API Docs', url: `${config?.serverUrl || 'http://localhost:8000'}/docs` },
                { label: 'Health Check', url: `${config?.serverUrl || 'http://localhost:8000'}/health` },
                { label: 'GitHub', url: 'https://github.com/jstdv/imece' },
              ].map(link => (
                <button
                  key={link.label}
                  className="btn btn-ghost"
                  onClick={() => window.imece.openExternal(link.url)}
                  style={{ justifyContent: 'space-between', width: '100%' }}
                >
                  <span>{link.label}</span>
                  <span style={{ color: 'var(--text-2)' }}>↗</span>
                </button>
              ))}
            </div>
          </div>

          {config?.nodeId && (
            <div className="card" style={{ borderColor: 'rgba(255,95,82,0.2)' }}>
              <div className="section-title" style={{ color: 'var(--red)' }}>Danger Zone</div>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>
                Clearing your node ID will require re-registration. Your token balance is preserved on the coordinator.
              </div>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  if (confirm('Clear node ID and reset local configuration?')) {
                    await setConfig({ nodeId: null, hardwareClass: null, multiplier: 1.0 })
                  }
                }}
              >
                Clear Node ID
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
