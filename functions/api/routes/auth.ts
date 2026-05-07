import { Hono } from 'hono'
import { signJWT } from '../lib/jwt'
import { hashPasscode, randomHex } from '../lib/crypto'
import { authMiddleware } from '../middleware/auth'
import type { HonoEnv } from '../lib/types'

const auth = new Hono<HonoEnv>()

function jwtExp() {
  return Math.floor(Date.now() / 1000) + 86_400 * 30 // 30 days
}

// GET /auth/status — does admin exist yet?
auth.get('/status', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>()
  return c.json({ needsSetup: (row?.count ?? 0) === 0 })
})

// POST /auth/setup — one-time admin creation (fails if any user exists)
auth.post('/setup', async (c) => {
  const existing = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>()
  if ((existing?.count ?? 0) > 0) return c.json({ error: 'Admin already exists' }, 403)

  const body = await c.req.json<{ name: string; passcode: string }>()
  if (!body.name?.trim() || !body.passcode?.trim()) return c.json({ error: 'Name and passcode required' }, 400)

  const salt = randomHex()
  const hash = await hashPasscode(body.passcode, salt)

  const user = await c.env.DB.prepare(
    `INSERT INTO users (name, role, passcode_hash, passcode_salt) VALUES (?, 'admin', ?, ?)
     RETURNING id, name, role`
  ).bind(body.name.trim(), hash, salt).first<{ id: number; name: string; role: string }>()

  const token = await signJWT({ sub: user!.id, name: user!.name, role: user!.role, exp: jwtExp() }, c.env.JWT_SECRET)
  return c.json({ token, user })
})

// POST /auth/login
auth.post('/login', async (c) => {
  const body = await c.req.json<{ name: string; passcode: string }>()
  if (!body.name?.trim() || !body.passcode?.trim()) return c.json({ error: 'Name and passcode required' }, 400)

  const user = await c.env.DB.prepare(
    `SELECT id, name, role, passcode_hash, passcode_salt, is_active FROM users WHERE name = ? COLLATE NOCASE`
  ).bind(body.name.trim()).first<{ id: number; name: string; role: string; passcode_hash: string; passcode_salt: string; is_active: number }>()

  if (!user || !user.is_active) return c.json({ error: 'Invalid name or passcode' }, 401)

  const hash = await hashPasscode(body.passcode, user.passcode_salt)
  if (hash !== user.passcode_hash) return c.json({ error: 'Invalid name or passcode' }, 401)

  const token = await signJWT({ sub: user.id, name: user.name, role: user.role, exp: jwtExp() }, c.env.JWT_SECRET)
  return c.json({ token, user: { id: user.id, name: user.name, role: user.role } })
})

// POST /auth/invite — generate invite QR (admin → manager|player, manager → player)
auth.post('/invite', authMiddleware, async (c) => {
  const userRole = c.get('userRole')
  const userId = c.get('userId')

  if (userRole !== 'admin' && userRole !== 'manager') return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json<{ role?: string }>().catch(() => ({}))
  let targetRole: string
  if (userRole === 'manager') {
    targetRole = 'player'
  } else {
    // admin can invite manager or player; default to manager
    targetRole = body.role === 'player' ? 'player' : 'manager'
  }

  const token = randomHex(20)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  await c.env.DB.prepare(
    `INSERT INTO invite_tokens (token, role, created_by, expires_at) VALUES (?, ?, ?, ?)`
  ).bind(token, targetRole, userId, expiresAt).run()

  const origin = c.req.header('origin') ?? c.req.header('referer')?.replace(/\/[^/]*$/, '') ?? ''
  return c.json({ token, inviteUrl: `${origin}/invite?token=${token}`, role: targetRole, expiresAt })
})

// POST /auth/register — redeem invite token, create account
auth.post('/register', async (c) => {
  const body = await c.req.json<{ token: string; name: string; passcode: string }>()
  if (!body.token || !body.name?.trim() || !body.passcode?.trim()) {
    return c.json({ error: 'Token, name, and passcode required' }, 400)
  }

  const invite = await c.env.DB.prepare(
    `SELECT id, role, created_by, used_at, expires_at FROM invite_tokens WHERE token = ?`
  ).bind(body.token).first<{ id: number; role: string; created_by: number; used_at: string | null; expires_at: string }>()

  if (!invite)              return c.json({ error: 'Invalid invite link' }, 400)
  if (invite.used_at)       return c.json({ error: 'This invite has already been used' }, 400)
  if (new Date(invite.expires_at) < new Date()) return c.json({ error: 'Invite link has expired' }, 400)

  const taken = await c.env.DB.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE').bind(body.name.trim()).first()
  if (taken) return c.json({ error: 'That name is already taken' }, 409)

  const salt = randomHex()
  const hash = await hashPasscode(body.passcode, salt)

  const user = await c.env.DB.prepare(
    `INSERT INTO users (name, role, passcode_hash, passcode_salt, created_by) VALUES (?, ?, ?, ?, ?)
     RETURNING id, name, role`
  ).bind(body.name.trim(), invite.role, hash, salt, invite.created_by).first<{ id: number; name: string; role: string }>()

  await c.env.DB.prepare(`UPDATE invite_tokens SET used_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), invite.id).run()

  const token = await signJWT({ sub: user!.id, name: user!.name, role: user!.role, exp: jwtExp() }, c.env.JWT_SECRET)
  return c.json({ token, user })
})

// GET /auth/me
auth.get('/me', authMiddleware, async (c) => {
  const user = await c.env.DB.prepare(
    `SELECT id, name, role, is_active as isActive, created_at as createdAt FROM users WHERE id = ?`
  ).bind(c.get('userId')).first()
  if (!user) return c.json({ error: 'Not found' }, 404)
  return c.json(user)
})

export default auth
