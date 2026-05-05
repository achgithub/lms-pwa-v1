import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import type { HonoEnv } from './lib/types'
import { authMiddleware } from './middleware/auth'
import authRoutes from './routes/auth'
import dataRoutes from './routes/data'

const app = new Hono<HonoEnv>().basePath('/api')

// Temp debug endpoint — remove after confirming env vars
app.get('/debug/env', (c) => c.json({
  hasJwtSecret: !!c.env.JWT_SECRET,
  jwtSecretLength: c.env.JWT_SECRET?.length ?? 0,
  hasDb: !!c.env.DB,
}))

// Public — no JWT required
app.route('/auth', authRoutes)

// Apply auth middleware in the main router with explicit path exclusion
// (sub-router middleware can lose env bindings in Pages Functions)
app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next()
  return authMiddleware(c, next)
})

app.route('/', dataRoutes)

export const onRequest = handle(app)
