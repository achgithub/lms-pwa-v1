import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import type { HonoEnv } from './lib/types'
import { authMiddleware } from './middleware/auth'
import { verifyJWT } from './lib/jwt'
import authRoutes from './routes/auth'
import dataRoutes from './routes/data'
import pushRoutes from './routes/push'

const app = new Hono<HonoEnv>().basePath('/api')

// Temp debug endpoint — remove after diagnosis
app.get('/debug/env', async (c) => {
  const info: Record<string, unknown> = {
    hasJwtSecret: !!c.env.JWT_SECRET,
    jwtSecretLength: c.env.JWT_SECRET?.length ?? 0,
    hasDb: !!c.env.DB,
    path: c.req.path,
  }
  const header = c.req.header('Authorization')
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = await verifyJWT(header.slice(7), c.env.JWT_SECRET)
      info.tokenVerify = 'ok'
      info.tokenPayload = payload
    } catch (e) {
      info.tokenVerify = 'failed'
      info.tokenError = String(e)
    }
  } else {
    info.tokenVerify = 'no token provided'
  }
  return c.json(info)
})

// Public — no JWT required
app.route('/auth', authRoutes)

// Apply auth middleware in the main router with explicit path exclusion
// (sub-router middleware can lose env bindings in Pages Functions)
app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next()

  // Allow SYNC_SECRET bearer token for curl-based admin sync endpoints
  const syncPaths = ['/api/admin/sync-fixtures', '/api/admin/import-teams', '/api/admin/sync-standings']
  if (c.req.method === 'POST' && syncPaths.includes(c.req.path)) {
    const syncSecret = c.env.SYNC_SECRET
    const header = c.req.header('Authorization')
    if (syncSecret && header === `Bearer ${syncSecret}`) {
      c.set('userId', 0)
      c.set('userName', 'sync')
      c.set('userRole', 'admin')
      return next()
    }
  }

  return authMiddleware(c, next)
})

app.route('/', dataRoutes)
app.route('/push', pushRoutes)

export const onRequest = handle(app)
