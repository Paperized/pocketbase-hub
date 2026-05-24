import { useState } from 'react'
import { deleteInstance } from '../api'
import './DeleteModal.css'

interface Props {
  name: string
  onClose: () => void
  onDeleted: () => void
  onError?: (msg: string) => void
}

export function DeleteModal({ name, onClose, onDeleted, onError }: Props) {
  const [dropDbs, setDropDbs] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setDeleting(true)
    setError(null)
    try {
      await deleteInstance(name, dropDbs)
      onDeleted()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed'
      setDeleting(false)
      if (onError) {
        onError(msg)
      } else {
        setError(msg)
      }
    }
  }

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !deleting) onClose()
  }

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal delete-modal">
        <div className="modal-header">
          <h3>Delete instance</h3>
          <button className="modal-close" onClick={onClose} disabled={deleting}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="delete-warning">
            <span className="warning-icon">⚠</span>
            <div>
              <p className="warning-title">This action is permanent and cannot be undone.</p>
              <p className="warning-body">
                The container, configuration files and all data stored locally
                by instance <strong>{name}</strong> will be permanently deleted.
              </p>
            </div>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={dropDbs}
              onChange={(e) => setDropDbs(e.target.checked)}
              disabled={deleting}
            />
            <div className="checkbox-label">
              <span className="checkbox-title">Also drop PostgreSQL databases</span>
              <span className="checkbox-desc">
                Permanently deletes <code>pb-{name}</code> and <code>pb-{name}-logs</code>.
                All data stored in the database will be lost.
              </span>
            </div>
          </label>

          {error && <p className="form-error">{error}</p>}

          <div className="modal-footer">
            <button
              className="btn-secondary"
              onClick={onClose}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              className="btn-danger"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete instance'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
