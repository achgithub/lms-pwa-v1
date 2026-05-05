import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import type { HonoEnv } from './lib/types'
import { authMiddleware } from './middleware/auth'
import authRoutes from './routes/auth'
import dataRoutes from './routes/data'

const app = new Hono<HonoEnv>().basePath('/api')

// Public — no JWT required
app.route('/auth', authRoutes)

// Protected — authMiddleware is applied inside dataRoutes
app.route('/', dataRoutes)

export const onRequest = handle(app)
