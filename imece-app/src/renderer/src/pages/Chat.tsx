import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ImeceConfig } from '../lib/types'
import { NodeState } from '../hooks/useNode'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  meta?: {
    model?: string
    backend?: string
    latencyMs?: number
    gftCost?: number
    tokens?: number
  }
}

interface Props {
  config: ImeceConfig | null
  node: NodeState
  backendMode: "" | "distributed" | "fallback"
}

const PRECISIONS = ['fp16', 'fp32', 'int8'] as const

export default function Chat({ config, node, backendMode }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [models, setModels] = useState<any[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [maxTokens, setMaxTokens] = useState(256)
  const [precision, setPrecision] = useState<'fp16' | 'fp32' | 'int8'>('fp16')
  const [costEstimate, setCostEstimate] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load models
  useEffect(() => {
    if (!config?.serverUrl) return
    window.imece.getModels().then(d => {
      const list = d?.models || []
      setModels(list)
      if (list.length > 0 && !selectedModel) {
        setSelectedModel(list[0].model_id)
      }
    }).catch(() => {})
  }, [config?.serverUrl])

  // Cost estimate when params change
  useEffect(() => {
    if (!selectedModel) return
    window.imece.estimateCost({ model_id: selectedModel, max_new_tokens: maxTokens, precision })
      .then(d => setCostEstimate(d?.estimated_gft ?? null))
      .catch(() => setCostEstimate(null))
  }, [selectedModel, maxTokens, precision])

  // Scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = useCallback(async () => {
    if (!input.trim() || loading || !config?.nodeId) return

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const res = await window.imece.generate({
        node_id: config.nodeId,
        model_id: selectedModel || config.modelId,
        prompt: userMsg.content,
        max_new_tokens: maxTokens,
        temperature: 0.7,
        precision,
        force_backend: backendMode || null,
        request_id: `chat-${Date.now()}`,
      })

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: res.text || '[No response]',
        timestamp: new Date(),
        meta: {
          model: selectedModel,
          backend: res.backend,
          latencyMs: res.latency_ms,
          gftCost: res.gft_deducted,
          tokens: res.tokens,
        },
      }

      setMessages(prev => [...prev, assistantMsg])
    } catch (err: any) {
      setError(err.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }, [input, loading, config, selectedModel, maxTokens, precision])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const clearHistory = () => setMessages([])

  const balance = node.stats?.balance ?? 0
  const canSend = config?.nodeId && balance > 0 && !loading && input.trim().length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'var(--bg-1)',
        flexShrink: 0,
      }}>
        <select
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value)}
          style={{ width: 'auto', flex: 1, maxWidth: 260 }}
        >
          {models.map(m => (
            <option key={m.model_id} value={m.model_id}>
              {m.friendly_name}
              {m.pipeline_available ? ' ✓' : ' (fallback)'}
            </option>
          ))}
        </select>

        <select
          value={precision}
          onChange={e => setPrecision(e.target.value as any)}
          style={{ width: 80 }}
        >
          {PRECISIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-2)' }}>Tokens</span>
          <input
            type="number"
            value={maxTokens}
            onChange={e => setMaxTokens(Math.max(1, Math.min(2048, Number(e.target.value))))}
            style={{ width: 64, textAlign: 'center' }}
          />
        </div>

        {costEstimate !== null && (
          <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
            ~{costEstimate.toFixed(4)} GFT
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>
            {balance.toFixed(4)} GFT
          </span>
          {messages.length > 0 && (
            <button className="btn btn-ghost" onClick={clearHistory} style={{ padding: '4px 10px' }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {messages.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-2)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>◌</div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>No messages yet</div>
            <div style={{ fontSize: 11 }}>
              {!config?.nodeId
                ? 'Set up your node in Settings first'
                : balance <= 0
                  ? 'Start contributing to earn GFT, then send messages'
                  : 'Send a message to get started'}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
            gap: 4,
          }}>
            <div style={{
              maxWidth: '75%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user'
                ? '12px 12px 3px 12px'
                : '12px 12px 12px 3px',
              background: msg.role === 'user' ? 'var(--accent-bg)' : 'var(--bg-2)',
              border: `1px solid ${msg.role === 'user' ? 'rgba(200,240,96,0.2)' : 'var(--border)'}`,
              color: 'var(--text-0)',
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {msg.content}
            </div>

            {msg.meta && (
              <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                {msg.meta.backend && (
                  <span className={`tag ${msg.meta.backend === 'distributed' ? 'green' : 'yellow'}`} style={{ fontSize: 9 }}>
                    {msg.meta.backend}
                  </span>
                )}
                {msg.meta.latencyMs && <span>{msg.meta.latencyMs.toFixed(0)}ms</span>}
                {msg.meta.tokens && <span>{msg.meta.tokens} tokens</span>}
                {msg.meta.gftCost && <span style={{ color: 'var(--accent)' }}>{msg.meta.gftCost.toFixed(4)} GFT</span>}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--accent)',
                  animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-2)' }}>Generating…</span>
          </div>
        )}

        {error && (
          <div style={{
            padding: '10px 14px',
            background: 'var(--red-bg)',
            border: '1px solid rgba(255,95,82,0.2)',
            borderRadius: 5,
            fontSize: 12,
            color: 'var(--red)',
          }}>
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-1)',
        flexShrink: 0,
      }}>
        {!config?.nodeId && (
          <div style={{ fontSize: 11, color: 'var(--yellow)', marginBottom: 8, textAlign: 'center' }}>
            Set up your node in Settings to start chatting
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={config?.nodeId ? 'Send a message… (Enter to send, Shift+Enter for new line)' : 'Node not configured'}
            disabled={!config?.nodeId || loading}
            style={{
              flex: 1,
              resize: 'none',
              minHeight: 42,
              maxHeight: 140,
              lineHeight: 1.5,
              padding: '10px 12px',
            }}
            rows={1}
          />
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={!canSend}
            style={{ height: 42, padding: '0 18px', flexShrink: 0 }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
