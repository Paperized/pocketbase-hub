import { useState } from 'react'
import { type Instance } from '../api'
import { DeleteModal } from './DeleteModal'
import './InstanceCard.css'

interface Props {
  instance: Instance
  onDeleted: () => void
}

export function InstanceCard({ instance, onDeleted }: Props) {
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const statusLabel = {
    running: 'Running',
    restarting: 'Restarting',
    exited: 'Stopped',
    unknown: 'Unknown',
  }[instance.status]

  return (
    <>
      <div className={`instance-card ${deleting ? 'deleting' : ''}`}>
        <div className="card-top">
          <div className="card-name">{instance.name}</div>
          <span className={`status-badge status-${instance.status}`}>
            {statusLabel}
          </span>
        </div>

        <a
          className="card-url"
          href={instance.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {instance.url.replace(/^https?:\/\//, '')}
        </a>

        {error && <p className="card-error">{error}</p>}

        <div className="card-actions">
          <button
            className="btn-danger-outline"
            onClick={() => setShowDelete(true)}
            disabled={deleting}
          >
            Delete
          </button>
        </div>
      </div>

      {showDelete && (
        <DeleteModal
          name={instance.name}
          onClose={() => setShowDelete(false)}
          onDeleted={() => {
            setDeleting(true)
            setShowDelete(false)
            onDeleted()
          }}
          onError={(msg) => {
            setError(msg)
            setShowDelete(false)
          }}
        />
      )}
    </>
  )
}
