import React, { useState } from 'react'
import { useNode } from './hooks/useNode'
import { useConfig } from './hooks/useConfig'
import Dashboard from './pages/Dashboard'
import Chat from './pages/Chat'
import Contribute from './pages/Contribute'
import Settings from './pages/Settings'
import './styles/app.css'

type Page = 'dashboard' | 'chat' | 'contribute' | 'settings'


const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard',  label: 'Dashboard',  icon: '⬡' },
  { id: 'chat',       label: 'Chat',        icon: '◌' },
  { id: 'contribute', label: 'Contribute',  icon: '▲' },
  { id: 'settings',  label: 'Settings',    icon: '◈' },
]

export default function App() {
  const [backendMode, setBackendMode] = useState<"" | "distributed" | "fallback">("");

  const [page, setPage] = useState<Page>('dashboard')
  const node = useNode()
  const { config } = useConfig()

  const statusDot = node.running ? 'green pulse' : node.status === 'connecting' ? 'yellow pulse' : 'grey'

  return (
    <div className="app">
      {/* Titlebar */}
      <div className="titlebar-backend-select">
        <select
          value={backendMode}
          onChange={(e) => setBackendMode(e.target.value as any)}
          className="backend-select"
        >
          <option value="">Auto</option>
          <option value="distributed">Distributed</option>
          <option value="fallback">Fallback</option>
        </select>
      </div>

      <div className="titlebar">
        <span className="titlebar-logo">imece</span>
        <div className="titlebar-status">
          <div className={`dot ${statusDot}`} />
          <span className="titlebar-status-text">{node.status}</span>
        </div>
        {node.stats && (
          <div className="titlebar-balance mono">
            {node.stats.balance.toFixed(4)} GFT
          </div>
        )}
      </div>

      <div className="app-body">
        {/* Sidebar */}
        <nav className="sidebar">
          <div className="sidebar-nav">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => setPage(item.id)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </button>
            ))}
          </div>

          <div className="sidebar-footer">
            {config?.nodeId ? (
              <div className="node-id-display">
                <span className="label">Node</span>
                <span className="mono truncate" style={{ fontSize: 10, color: 'var(--text-2)' }}>
                  {config.nodeId.slice(0, 16)}…
                </span>
              </div>
            ) : (
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setPage('settings')}>
                Setup Node
              </button>
            )}
          </div>
        </nav>

        {/* Main content */}
        <main className="content">
          {page === 'dashboard'  && <Dashboard node={node} config={config} />}
          {page === 'chat' && <Chat config={config} node={node} backendMode={backendMode} />}
          {page === 'contribute' && <Contribute node={node} config={config} />}
          {page === 'settings'   && <Settings config={config} onNavigate={setPage} />}
        </main>
      </div>
    </div>
  )
}
