import { verify } from 'hono/jwt'
import type { Context, Next } from 'hono'
import type { HonoEnv, Role } from '../lib/types'

interface JwtPayload { sub: number; name: string; role: Role; exp: number }

export async function authMiddleware(c: Context<HonoEnv>, next: Next) {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const payload = await verify(header.slice(7), c.env.JWT_SECRET) as JwtPayload
    c.set('userId', payload.sub)
    c.set('userName', payload.name)
    c.set('userRole', payload.role)
    await next()
  } catch {
    return c.json({ error: 'Unauthorized' }, 401)
  }
}

export function requireRole(...roles: Role[]) {
  return async (c: Context<HonoEnv>, next: Next) => {
    if (!roles.includes(c.get('userRole'))) return c.json({ error: 'Forbidden' }, 403)
    await next()
  }
}
