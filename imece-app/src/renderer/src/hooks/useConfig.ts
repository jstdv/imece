import { useState, useEffect, useCallback } from 'react'
import { ImeceConfig } from '../lib/types'

export function useConfig() {
  const [config, setConfigState] = useState<ImeceConfig | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.imece.getConfig().then(c => {
      setConfigState(c)
      setLoading(false)
    })
  }, [])

  const setConfig = useCallback(async (updates: Partial<ImeceConfig>) => {
    const updated = await window.imece.setConfig(updates)
    setConfigState(updated)
    return updated
  }, [])

  return { config, setConfig, loading }
}
