import { Context, Next } from 'hono'

export function basicAuth(user: string, pass: string) {
  // If no user is configured, auth is disabled — all requests pass through
  const enabled = user.trim() !== ''

  return async (c: Context, next: Next) => {
    if (!enabled) return next()

    const header = c.req.header('Authorization') || ''

    if (header.startsWith('Basic ')) {
      const encoded = header.slice(6)
      const decoded = atob(encoded)
      const [u, ...rest] = decoded.split(':')
      const p = rest.join(':')
      if (u === user && p === pass) {
        return next()
      }
    }

    c.header('WWW-Authenticate', 'Basic realm="PocketBase Hub"')
    return c.json({ error: 'Unauthorized' }, 401)
  }
}
