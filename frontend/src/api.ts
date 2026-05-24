export interface Instance {
  name: string
  subdomain: string
  status: 'running' | 'restarting' | 'exited' | 'unknown'
  url: string
}

export interface AppConfig {
  domain: string
  scheme: string
}

export interface CreatedInstance {
  name: string
  subdomain: string
  adminEmail?: string
  adminPassword?: string
}

const BASE = '/api'

function authHeader(): HeadersInit {
  const user = (window as any).__PBH_USER__ || ''
  const pass = (window as any).__PBH_PASS__ || ''
  if (user) {
    return { Authorization: 'Basic ' + btoa(`${user}:${pass}`) }
  }
  return {}
}

export async function getConfig(): Promise<AppConfig> {
  const res = await fetch(`${BASE}/config`, { headers: authHeader() })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function listInstances(): Promise<Instance[]> {
  const res = await fetch(`${BASE}/instances`, { headers: authHeader() })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function createInstance(params: {
  name: string
  subdomain: string
  adminEmail: string
  adminPassword: string
}): Promise<CreatedInstance> {
  const res = await fetch(`${BASE}/instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function deleteInstance(name: string, dropDbs = false): Promise<void> {
  const url = `${BASE}/instances/${encodeURIComponent(name)}${dropDbs ? '?dropDbs=true' : ''}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: authHeader(),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${res.status}`)
  }
}
