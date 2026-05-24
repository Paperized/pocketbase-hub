import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { logger } from 'hono/logger'
import { basicAuth } from './middleware/auth'
import instancesRouter from './routes/instances'

const app = new Hono()

app.use('*', logger())

// Health check — no auth required
app.get('/health', (c) => c.json({ ok: true }))

// API — protected by basic auth (disabled if DASHBOARD_USER is empty)
const user = process.env.DASHBOARD_USER ?? 'admin'
const pass = process.env.DASHBOARD_PASS ?? 'changeme'

app.use('/api/*', basicAuth(user, pass))
app.get('/api/config', (c) => c.json({
  domain: process.env.APP_DOMAIN || 'localhost',
  scheme: process.env.APP_SCHEME || 'https',
}))
app.route('/api/instances', instancesRouter)

// Serve frontend static files (production)
app.use('/*', serveStatic({ root: './public' }))
app.get('/*', serveStatic({ path: './public/index.html' }))

const port = parseInt(process.env.PORT || '3000', 10)
console.log(`PocketBase Hub listening on :${port}`)
console.log(`  DASHBOARD_USER: ${user}`)
console.log(`  APP_DOMAIN:     ${process.env.APP_DOMAIN || '(not set)'}`)
console.log(`  INSTANCES_DIR:  ${process.env.INSTANCES_DIR || '/instances'}`)
console.log(`  TRAEFIK_DIR:    ${process.env.TRAEFIK_DYNAMIC_DIR || '/traefik/dynamic'}`)
console.log(`  DOCKER_HOST:    ${process.env.DOCKER_HOST || '(not set — status will show unknown)'}`)

export default {
  port,
  fetch: app.fetch,
}
