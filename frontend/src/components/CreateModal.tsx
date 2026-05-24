import { useState, useEffect } from 'react'
import { createInstance, getConfig, CreatedInstance } from '../api'
import './CreateModal.css'

const NAME_REGEX = /^[a-z0-9-]+$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function generatePassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%'
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

interface Props {
  onClose: () => void
  onCreated: () => void
}

export function CreateModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [subdomainTouched, setSubdomainTouched] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState(generatePassword())
  const [showPassword, setShowPassword] = useState(false)
  const [baseDomain, setBaseDomain] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedInstance | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    getConfig().then((c) => setBaseDomain(c.domain)).catch(() => {})
  }, [])

  // Keep subdomain in sync with name unless user has manually edited it
  useEffect(() => {
    if (!subdomainTouched) setSubdomain(name)
  }, [name, subdomainTouched])

  // Keep admin email in sync with name unless user has edited it
  const [emailTouched, setEmailTouched] = useState(false)
  useEffect(() => {
    if (!emailTouched && name) setAdminEmail(`admin@${name}.local`)
  }, [name, emailTouched])

  const nameError =
    name.length > 0 && !NAME_REGEX.test(name)
      ? 'Only lowercase letters, numbers and hyphens'
      : name.length > 63
      ? 'Max 63 characters'
      : null

  const subdomainError =
    subdomain.length > 0 && !NAME_REGEX.test(subdomain)
      ? 'Only lowercase letters, numbers and hyphens'
      : subdomain.length > 63
      ? 'Max 63 characters'
      : null

  const emailError =
    adminEmail.length > 0 && !EMAIL_REGEX.test(adminEmail)
      ? 'Enter a valid email address'
      : null

  const passwordError =
    adminPassword.length > 0 && adminPassword.length < 8
      ? 'At least 8 characters required'
      : null

  const canSubmit =
    name.length > 0 &&
    subdomain.length > 0 &&
    adminEmail.length > 0 &&
    adminPassword.length > 0 &&
    !nameError && !subdomainError && !emailError && !passwordError &&
    !loading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const result = await createInstance({
        name: name.trim(),
        subdomain: subdomain.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword,
      })
      setCreated(result)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
      setLoading(false)
    }
  }

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !loading) onClose()
  }

  const copyToClipboard = (value: string, key: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  // Success screen
  if (created) {
    return (
      <div className="modal-backdrop" onClick={handleBackdrop}>
        <div className="modal">
          <div className="modal-header">
            <h3>Instance created</h3>
          </div>
          <div className="modal-body">
            <p style={{ fontSize: 13, color: 'var(--text)', margin: 0 }}>
              Save these credentials — they won't be shown again.
            </p>

            {created.adminEmail && (
              <div className="field">
                <label>Admin email</label>
                <div className="cred-row">
                  <code className="cred-value">{created.adminEmail}</code>
                  <button className="btn-copy" onClick={() => copyToClipboard(created.adminEmail!, 'email')}>
                    {copied === 'email' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            {created.adminPassword && (
              <div className="field">
                <label>Admin password</label>
                <div className="cred-row">
                  <code className="cred-value">{created.adminPassword}</code>
                  <button className="btn-copy" onClick={() => copyToClipboard(created.adminPassword!, 'pass')}>
                    {copied === 'pass' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            <div className="modal-footer">
              <button className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal">
        <div className="modal-header">
          <h3>New PocketBase Instance</h3>
          <button className="modal-close" onClick={onClose} disabled={loading}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">

          {/* Instance name */}
          <div className="field">
            <label htmlFor="inst-name">Instance name</label>
            <input
              id="inst-name"
              type="text"
              placeholder="my-project"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              className={nameError ? 'error' : ''}
              disabled={loading}
              autoFocus
            />
            {nameError
              ? <p className="field-error">{nameError}</p>
              : <p className="field-hint">Internal identifier — used for container name and database.</p>
            }
          </div>

          {/* Subdomain */}
          <div className="field">
            <label htmlFor="inst-subdomain">Subdomain</label>
            <div className="subdomain-row">
              <input
                id="inst-subdomain"
                type="text"
                placeholder="my-project"
                value={subdomain}
                onChange={(e) => {
                  setSubdomainTouched(true)
                  setSubdomain(e.target.value.toLowerCase())
                }}
                className={subdomainError ? 'error' : ''}
                disabled={loading}
              />
              {baseDomain && (
                <span className="subdomain-suffix">.{baseDomain}</span>
              )}
            </div>
            {subdomainError
              ? <p className="field-error">{subdomainError}</p>
              : subdomain && baseDomain
              ? <p className="field-hint">Reachable at <strong>{subdomain}.{baseDomain}</strong></p>
              : <p className="field-hint">The public URL subdomain.</p>
            }
          </div>

          {/* Admin email */}
          <div className="field">
            <label htmlFor="inst-email">Admin email</label>
            <input
              id="inst-email"
              type="email"
              placeholder="admin@my-project.local"
              value={adminEmail}
              onChange={(e) => {
                setEmailTouched(true)
                setAdminEmail(e.target.value)
              }}
              className={emailError ? 'error' : ''}
              disabled={loading}
            />
            {emailError && <p className="field-error">{emailError}</p>}
          </div>

          {/* Admin password */}
          <div className="field">
            <label htmlFor="inst-password">Admin password</label>
            <div className="password-row">
              <input
                id="inst-password"
                type={showPassword ? 'text' : 'password'}
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className={passwordError ? 'error' : ''}
                disabled={loading}
              />
              <button
                type="button"
                className="btn-copy"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
              <button
                type="button"
                className="btn-copy"
                onClick={() => setAdminPassword(generatePassword())}
                disabled={loading}
                tabIndex={-1}
              >
                Generate
              </button>
            </div>
            {passwordError
              ? <p className="field-error">{passwordError}</p>
              : <p className="field-hint">Min 8 characters.</p>
            }
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
