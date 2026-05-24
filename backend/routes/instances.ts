import { Hono } from 'hono'
import { runScript } from '../scripts'

export interface Instance {
  name: string
  subdomain: string
  status: 'running' | 'restarting' | 'exited' | 'unknown'
  url: string
}

const NAME_REGEX = /^[a-z0-9-]+$/

async function getContainerStatus(name: string): Promise<Instance['status']> {
  const dockerHost = process.env.DOCKER_HOST || ''
  if (!dockerHost) return 'unknown'

  try {
    // Parse tcp://host:port
    const match = dockerHost.match(/^tcp:\/\/(.+):(\d+)$/)
    if (!match) return 'unknown'
    const [, host, port] = match

    const res = await fetch(`http://${host}:${port}/containers/pb_${name}/json`)
    if (!res.ok) return 'unknown'
    const data = await res.json() as { State?: { Status?: string } }
    const s = data?.State?.Status
    if (s === 'running') return 'running'
    if (s === 'restarting') return 'restarting'
    if (s === 'exited' || s === 'stopped' || s === 'dead') return 'exited'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

const router = new Hono()

// GET /api/instances
router.get('/', async (c) => {
  const result = await runScript('list-instances.sh')
  if (result.exitCode !== 0) {
    return c.json({ error: result.stderr || 'Failed to list instances' }, 500)
  }

  let items: { name: string; subdomain: string }[] = []
  try {
    items = JSON.parse(result.stdout)
  } catch {
    return c.json({ error: 'Invalid output from list script' }, 500)
  }

  const appDomain = process.env.APP_DOMAIN || 'localhost'
  const appScheme = process.env.APP_SCHEME || 'https'

  const instances: Instance[] = await Promise.all(
    items.map(async ({ name, subdomain }) => ({
      name,
      subdomain,
      status: await getContainerStatus(name),
      url: `${appScheme}://${subdomain}.${appDomain}`,
    }))
  )

  return c.json(instances)
})

// POST /api/instances  body: { name, subdomain?, adminEmail?, adminPassword? }
router.post('/', async (c) => {
  let body: { name?: string; subdomain?: string; adminEmail?: string; adminPassword?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { name, subdomain, adminEmail, adminPassword } = body

  if (!name || !NAME_REGEX.test(name)) {
    return c.json({ error: 'Name must match ^[a-z0-9-]+$' }, 400)
  }
  if (name.length > 63) {
    return c.json({ error: 'Name must be 63 chars max' }, 400)
  }
  if (name === 'template') {
    return c.json({ error: 'Reserved name' }, 400)
  }
  if (subdomain && !NAME_REGEX.test(subdomain)) {
    return c.json({ error: 'Subdomain must match ^[a-z0-9-]+$' }, 400)
  }
  if (subdomain && subdomain.length > 63) {
    return c.json({ error: 'Subdomain must be 63 chars max' }, 400)
  }

  const scriptEnv: Record<string, string> = {}
  if (subdomain) scriptEnv.INSTANCE_SUBDOMAIN = subdomain
  if (adminEmail) scriptEnv.INSTANCE_ADMIN_EMAIL = adminEmail
  if (adminPassword) scriptEnv.INSTANCE_ADMIN_PASSWORD = adminPassword

  const result = await runScript('new-instance.sh', [name], scriptEnv)
  if (result.exitCode !== 0) {
    return c.json({ error: result.stderr || 'Failed to create instance' }, 500)
  }

  // Script emits a JSON line as the last line with admin credentials
  let adminEmailOut: string | undefined
  let adminPasswordOut: string | undefined
  const lastLine = result.stdout.trim().split('\n').at(-1) || ''
  try {
    const creds = JSON.parse(lastLine)
    adminEmailOut = creds.adminEmail
    adminPasswordOut = creds.adminPassword
  } catch {
    // credentials not available, non-fatal
  }

  return c.json({
    name,
    subdomain: subdomain || name,
    message: 'Instance created',
    adminEmail: adminEmailOut,
    adminPassword: adminPasswordOut,
  }, 201)
})

// DELETE /api/instances/:name
router.delete('/:name', async (c) => {
  const name = c.req.param('name')

  if (!NAME_REGEX.test(name)) {
    return c.json({ error: 'Invalid instance name' }, 400)
  }

  const dropDbs = c.req.query('dropDbs') === 'true'
  const args = dropDbs ? [name, '--drop-dbs'] : [name]

  const result = await runScript('delete-instance.sh', args)
  if (result.exitCode !== 0) {
    return c.json({ error: result.stderr || 'Failed to delete instance' }, 500)
  }

  return c.json({ name, message: 'Instance deleted' })
})

export default router
