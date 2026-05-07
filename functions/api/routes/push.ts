import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types'
import { requireRole } from '../middleware/auth'
import { sendPush, PushGoneError } from '../lib/webpush'
import type { PushSubscription } from '../lib/webpush'

const push = new Hono<HonoEnv>()


push.get('/vapid-public-key', (c) => {
  const key = c.env.VAPID_PUBLIC_KEY
  if (!key) return c.json({ error: 'Push not configured' }, 503)
  return c.json({ key })
})

push.post('/subscribe', async (c) => {
  const userId = c.get('userId')
  const { endpoint, p256dh, auth } = await c.req.json<{ endpoint: string; p256dh: string; auth: string }>()
  if (!endpoint || !p256dh || !auth) return c.json({ error: 'Invalid subscription' }, 400)

  const userName = c.get('userName')

  await c.env.DB.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
  `).bind(userId, endpoint, p256dh, auth).run()

  const linkResult = await c.env.DB.prepare(`
    UPDATE participants SET user_id = ? WHERE player_name = ? COLLATE NOCASE
  `).bind(userId, userName).run()

  return c.json({ linked: linkResult.meta.changes })
})

push.delete('/subscribe', async (c) => {
  const userId = c.get('userId')
  const { endpoint } = await c.req.json<{ endpoint: string }>()
  if (!endpoint) return c.json({ error: 'endpoint required' }, 400)

  await c.env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'
  ).bind(userId, endpoint).run()

  return new Response(null, { status: 204 })
})

type NotifyType = 'round-opened' | 'closing-soon' | 'eliminated'

// Manager/admin sends a push to participants in a game.
push.post('/notify', requireRole('admin', 'manager'), async (c) => {
  const { gameId, type } = await c.req.json<{ gameId: number; type: NotifyType }>()
  if (!gameId || !type) return c.json({ error: 'gameId and type required' }, 400)

  const vapidPublicKey     = c.env.VAPID_PUBLIC_KEY
  const vapidPrivateKeyJwk = c.env.VAPID_PRIVATE_KEY_JWK
  if (!vapidPublicKey || !vapidPrivateKeyJwk) return c.json({ error: 'Push not configured' }, 503)

  const privateKeyJwk = JSON.parse(vapidPrivateKeyJwk) as JsonWebKey

  // Fetch subscriptions via participants.user_id (linked at subscribe time)
  const subsSQL = type === 'eliminated'
    ? `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN participants p ON p.user_id = ps.user_id
       WHERE p.game_id = ? AND p.is_active = 0
         AND p.eliminated_in_round = (
           SELECT MAX(r.round_number) FROM rounds r WHERE r.game_id = ? AND r.status = 'closed'
         )`
    : `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN participants p ON p.user_id = ps.user_id
       WHERE p.game_id = ? AND p.is_active = 1`

  const bindings = type === 'eliminated' ? [gameId, gameId] : [gameId]
  const { results: subs } = await c.env.DB.prepare(subsSQL).bind(...bindings).all<PushSubscription>()

  if (subs.length === 0) return c.json({ sent: 0 })

  const message = notifyMessage(type)
  let sent = 0
  const expiredEndpoints: string[] = []

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await sendPush(sub, message, vapidPublicKey, privateKeyJwk)
        sent++
      } catch (e) {
        if (e instanceof PushGoneError) expiredEndpoints.push(sub.endpoint)
      }
    })
  )

  // Remove stale subscriptions
  if (expiredEndpoints.length > 0) {
    await Promise.allSettled(
      expiredEndpoints.map(ep =>
        c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(ep).run()
      )
    )
  }

  return c.json({ sent })
})

function notifyMessage(type: NotifyType): { title: string; body: string } {
  switch (type) {
    case 'round-opened':
      return { title: 'New round open!', body: 'Head to the app and make your pick.' }
    case 'closing-soon':
      return { title: 'Round closing soon', body: "Time is running out — you haven't picked yet." }
    case 'eliminated':
      return { title: "You've been eliminated", body: 'Bad luck. You can still follow the action in the app.' }
  }
}

export default push
