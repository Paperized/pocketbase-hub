import { useState, useEffect, useCallback } from 'react'
import { listInstances, type Instance } from '../api'
import { InstanceCard } from './InstanceCard'
import { CreateModal } from './CreateModal'
import './InstanceList.css'

const POLL_INTERVAL = 10_000

export function InstanceList() {
  const [instances, setInstances] = useState<Instance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await listInstances()
      setInstances(data)
      setError(null)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(() => refresh(true), POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [refresh])

  return (
    <div className="instance-list">
      <div className="list-header">
        <div className="list-meta">
          <h2>Instances</h2>
          {lastRefresh && (
            <span className="last-refresh">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + New Instance
        </button>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button className="btn-text" onClick={() => refresh()}>Retry</button>
        </div>
      )}

      {loading && instances.length === 0 ? (
        <div className="empty-state">
          <div className="spinner" />
          <p>Loading instances...</p>
        </div>
      ) : instances.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No instances yet</p>
          <p className="empty-sub">Create your first PocketBase instance to get started.</p>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + New Instance
          </button>
        </div>
      ) : (
        <div className="cards-grid">
          {instances.map((inst) => (
            <InstanceCard
              key={inst.name}
              instance={inst}
              onDeleted={() => refresh()}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}
