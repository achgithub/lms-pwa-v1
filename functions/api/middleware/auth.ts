import type { Context, Next } from 'hono'
import { verifyJWT } from '../lib/jwt'
import type { HonoEnv, Role } from '../lib/types'

export async function authMiddleware(c: Context<HonoEnv>, next: Next) {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const payload = await verifyJWT(header.slice(7), c.env.JWT_SECRET)
    c.set('userId', payload.sub)
    c.set('userName', payload.name)
    c.set('userRole', payload.role)
    await next()
  } catch (e) {
    return c.json({ error: 'Unauthorized', detail: String(e) }, 401)
  }
}

export function requireRole(...roles: Role[]) {
  return async (c: Context<HonoEnv>, next: Next) => {
    if (!roles.includes(c.get('userRole'))) return c.json({ error: 'Forbidden' }, 403)
    await next()
  }
}
