import { useState, useEffect } from 'react'
import { NodeStats } from '../lib/types'

export interface NodeState {
  running: boolean
  status: string
  stats: NodeStats | null
}

export function useNode() {
  const [state, setState] = useState<NodeState>({
    running: false,
    status: 'stopped',
    stats: null,
  })

  useEffect(() => {
    // Get initial status
    window.imece.getNodeStatus().then(s => {
      setState({ running: s.running, status: s.status, stats: s.stats })
    })

    // Subscribe to live updates
    const unsubStatus = window.imece.onNodeStatus(status => {
      setState(prev => ({ ...prev, status, running: status === 'contributing' }))
    })

    const unsubStats = window.imece.onNodeStats(stats => {
      setState(prev => ({ ...prev, stats: stats as NodeStats }))
    })

    return () => {
      unsubStatus()
      unsubStats()
    }
  }, [])

  const start = async () => {
    setState(prev => ({ ...prev, status: 'connecting' }))
    await window.imece.startNode()
  }

  const stop = async () => {
    await window.imece.stopNode()
    setState(prev => ({ ...prev, running: false, status: 'stopped' }))
  }

  return { ...state, start, stop }
}
