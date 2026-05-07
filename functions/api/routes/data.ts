import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types'
import { requireRole } from '../middleware/auth'
import type { Game, Group, Participant, Pick, Player, Team, Round } from '../../../src/types'
const data = new Hono<HonoEnv>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapGame(row: Record<string, unknown>): Game {
  return { ...row, postponeAsWin: Boolean(row.postponeAsWin) } as Game
}

function mapParticipant(row: Record<string, unknown>): Participant {
  return { ...row, isActive: Boolean(row.isActive) } as Participant
}

function mapPick(row: Record<string, unknown>): Pick {
  return { ...row, autoAssigned: Boolean(row.autoAssigned) } as Pick
}

const GAME_SELECT = `
  SELECT g.id, g.name, g.group_id as groupId, gr.name as groupName,
         g.status, g.winner_name as winnerName,
         g.postpone_as_win as postponeAsWin, g.winner_mode as winnerMode,
         g.rollover_mode as rolloverMode, g.max_winners as maxWinners,
         g.participant_count as participantCount, g.current_round as currentRound,
         g.created_at as createdAt
  FROM games g JOIN groups gr ON gr.id = g.group_id`

// ── Groups ────────────────────────────────────────────────────────────────────

data.get('/groups', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT g.id, g.name, g.created_at as createdAt, COUNT(t.id) as teamCount
    FROM groups g LEFT JOIN teams t ON t.group_id = g.id
    GROUP BY g.id ORDER BY g.created_at
  `).all<Group>()
  return c.json(results)
})

data.post('/groups', requireRole('admin'), async (c) => {
  const { name } = await c.req.json<{ name: string }>()
  if (!name?.trim()) return c.json({ error: 'name required' }, 400)
  const row = await c.env.DB.prepare(
    `INSERT INTO groups (name, manager_id) VALUES (?, ?) RETURNING id, name, created_at as createdAt`
  ).bind(name.trim(), c.get('userId')).first<Omit<Group, 'teamCount'>>()
  return c.json({ ...row, teamCount: 0 } as Group, 201)
})

data.delete('/groups/:id', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM teams WHERE group_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(id),
  ])
  return new Response(null, { status: 204 })
})

// ── Teams ─────────────────────────────────────────────────────────────────────

data.get('/groups/:groupId/teams', async (c) => {
  const groupId = Number(c.req.param('groupId'))
  const { results } = await c.env.DB.prepare(
    `SELECT id, group_id as groupId, name, external_id as externalId, crest_url as crestUrl, created_at as createdAt FROM teams WHERE group_id = ? ORDER BY name`
  ).bind(groupId).all<Team>()
  return c.json(results)
})

data.post('/groups/:groupId/teams', requireRole('admin'), async (c) => {
  const groupId = Number(c.req.param('groupId'))
  const { name } = await c.req.json<{ name: string }>()
  if (!name?.trim()) return c.json({ error: 'name required' }, 400)
  const row = await c.env.DB.prepare(
    `INSERT INTO teams (group_id, name) VALUES (?, ?) RETURNING id, group_id as groupId, name, created_at as createdAt`
  ).bind(groupId, name.trim()).first<Team>()
  return c.json(row, 201)
})

data.delete('/teams/:id', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'))
  const active = await c.env.DB.prepare(
    `SELECT 1 FROM games g JOIN teams t ON t.group_id = g.group_id WHERE t.id = ? AND g.status = 'active' LIMIT 1`
  ).bind(id).first()
  if (active) return c.json({ error: 'This team belongs to a group with an active game and cannot be deleted' }, 409)
  await c.env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(id).run()
  return new Response(null, { status: 204 })
})

// ── Admin: Import PL teams from curl-posted football-data.org payload ────────

data.post('/admin/import-teams', requireRole('admin'), async (c) => {
  const { groupId, teams } = await c.req.json<{
    groupId: number
    teams: Array<{ id: number; name: string; crest: string }>
  }>()
  if (!groupId) return c.json({ error: 'groupId required' }, 400)
  if (!Array.isArray(teams) || teams.length === 0) return c.json({ error: 'teams array required' }, 400)

  const group = await c.env.DB.prepare(`SELECT id FROM groups WHERE id = ?`).bind(groupId).first()
  if (!group) return c.json({ error: 'Group not found' }, 404)

  const stmts = teams.map((t) =>
    c.env.DB.prepare(`
      INSERT INTO teams (group_id, name, external_id, crest_url)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(group_id, external_id) DO UPDATE SET
        name      = excluded.name,
        crest_url = excluded.crest_url
    `).bind(groupId, t.name, t.id, t.crest)
  )

  await c.env.DB.batch(stmts)
  return c.json({ imported: teams.length })
})

// ── Admin: Sync fixtures from curl-posted football-data.org payload ──────────

interface FDMatch {
  id: number
  matchday: number
  utcDate: string
  status: string
  homeTeam: { name: string }
  awayTeam: { name: string }
  score: { winner: string | null; fullTime: { home: number | null; away: number | null } }
}

data.post('/admin/sync-fixtures', requireRole('admin'), async (c) => {
  const { matches } = await c.req.json<{ matches: FDMatch[] }>()
  if (!Array.isArray(matches) || matches.length === 0) return c.json({ error: 'matches array required' }, 400)

  const now = new Date().toISOString()
  const stmts = matches.map((m) =>
    c.env.DB.prepare(`
      INSERT INTO fixtures (id, matchday, utc_date, status, home_team_name, away_team_name, home_score, away_score, winner, last_synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status         = excluded.status,
        home_score     = excluded.home_score,
        away_score     = excluded.away_score,
        winner         = excluded.winner,
        last_synced    = excluded.last_synced
    `).bind(
      m.id, m.matchday, m.utcDate, m.status,
      m.homeTeam.name, m.awayTeam.name,
      m.score.fullTime.home ?? null,
      m.score.fullTime.away ?? null,
      m.score.winner ?? null,
      now,
    )
  )

  for (let i = 0; i < stmts.length; i += 100) {
    await c.env.DB.batch(stmts.slice(i, i + 100))
  }

  return c.json({ synced: matches.length })
})

// ── Players ───────────────────────────────────────────────────────────────────

data.get('/players', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, created_at as createdAt FROM players ORDER BY name`
  ).all<Player>()
  return c.json(results)
})

data.post('/players', requireRole('admin', 'manager'), async (c) => {
  const { name } = await c.req.json<{ name: string }>()
  if (!name?.trim()) return c.json({ error: 'name required' }, 400)
  const row = await c.env.DB.prepare(
    `INSERT INTO players (name) VALUES (?) RETURNING id, name, created_at as createdAt`
  ).bind(name.trim()).first<Player>()
  return c.json(row, 201)
})

data.delete('/players/:id', requireRole('admin', 'manager'), async (c) => {
  const id = Number(c.req.param('id'))
  const player = await c.env.DB.prepare(`SELECT name FROM players WHERE id = ?`).bind(id).first<{ name: string }>()
  if (!player) return c.json({ error: 'Not found' }, 404)
  const active = await c.env.DB.prepare(
    `SELECT 1 FROM participants p JOIN games g ON g.id = p.game_id WHERE p.player_name = ? AND g.status = 'active' LIMIT 1`
  ).bind(player.name).first()
  if (active) return c.json({ error: `${player.name} is in an active game and cannot be deleted` }, 409)
  await c.env.DB.prepare('DELETE FROM players WHERE id = ?').bind(id).run()
  return new Response(null, { status: 204 })
})

// ── Games ─────────────────────────────────────────────────────────────────────

data.get('/games', async (c) => {
  const role = c.get('userRole')
  const userId = c.get('userId')
  const userName = c.get('userName')
  const asPlayer = c.req.query('view') === 'player'

  if (role === 'player' || asPlayer) {
    const { results } = await c.env.DB.prepare(
      `${GAME_SELECT} JOIN participants p ON p.game_id = g.id WHERE p.player_name = ? ORDER BY g.created_at DESC`
    ).bind(userName).all<Record<string, unknown>>()
    return c.json(results.map(mapGame))
  }

  if (role === 'manager') {
    const { results } = await c.env.DB.prepare(
      `${GAME_SELECT} WHERE g.manager_id = ? ORDER BY g.created_at DESC`
    ).bind(userId).all<Record<string, unknown>>()
    return c.json(results.map(mapGame))
  }

  const { results } = await c.env.DB.prepare(
    `${GAME_SELECT} ORDER BY g.created_at DESC`
  ).all<Record<string, unknown>>()
  return c.json(results.map(mapGame))
})

data.post('/games', async (c) => {
  const body = await c.req.json<{
    name: string; groupId: number; playerNames: string[]
    postponeAsWin: boolean; winnerMode: string; rolloverMode: string; maxWinners: number
  }>()

  const gameRow = await c.env.DB.prepare(`
    INSERT INTO games (name, group_id, postpone_as_win, winner_mode, rollover_mode, max_winners, participant_count, manager_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
  `).bind(
    body.name, body.groupId, body.postponeAsWin ? 1 : 0,
    body.winnerMode, body.rolloverMode, body.maxWinners,
    body.playerNames.length, c.get('userId')
  ).first<{ id: number }>()

  const gameId = gameRow!.id

  await c.env.DB.batch([
    ...body.playerNames.map(name =>
      c.env.DB.prepare(`INSERT INTO participants (game_id, player_name) VALUES (?, ?)`).bind(gameId, name)
    ),
    c.env.DB.prepare(`INSERT INTO rounds (game_id, round_number, status) VALUES (?, 1, 'open')`).bind(gameId),
  ])

  const game = await c.env.DB.prepare(`${GAME_SELECT} WHERE g.id = ?`).bind(gameId).first<Record<string, unknown>>()
  return c.json(mapGame(game!), 201)
})

data.get('/games/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const role = c.get('userRole')
  const userId = c.get('userId')
  const userName = c.get('userName')
  const asPlayer = c.req.query('view') === 'player'

  const game = await c.env.DB.prepare(`${GAME_SELECT} WHERE g.id = ?`).bind(id).first<Record<string, unknown>>()
  if (!game) return c.json({ error: 'not found' }, 404)

  if (role === 'player' || asPlayer) {
    const member = await c.env.DB.prepare(
      `SELECT id FROM participants WHERE game_id = ? AND player_name = ?`
    ).bind(id, userName).first()
    if (!member) return c.json({ error: 'Forbidden' }, 403)
  } else if (role === 'manager') {
    const owned = await c.env.DB.prepare(
      `SELECT id FROM games WHERE id = ? AND manager_id = ?`
    ).bind(id, userId).first()
    if (!owned) return c.json({ error: 'Forbidden' }, 403)
  }

  const [parts, rounds, picks] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, game_id as gameId, player_name as playerName, is_active as isActive, eliminated_in_round as eliminatedInRound, created_at as createdAt FROM participants WHERE game_id = ?`
    ).bind(id).all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT id, game_id as gameId, round_number as roundNumber, status, created_at as createdAt FROM rounds WHERE game_id = ?`
    ).bind(id).all<Round>(),
    c.env.DB.prepare(
      `SELECT id, game_id as gameId, round_id as roundId, player_name as playerName, team_id as teamId, team_name as teamName, result, auto_assigned as autoAssigned, created_at as createdAt FROM picks WHERE game_id = ?`
    ).bind(id).all<Record<string, unknown>>(),
  ])

  return c.json({
    game: mapGame(game),
    participants: parts.results.map(mapParticipant),
    rounds: rounds.results,
    picks: picks.results.map(mapPick),
  })
})

data.delete('/games/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM picks WHERE game_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM rounds WHERE game_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM participants WHERE game_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM games WHERE id = ?').bind(id),
  ])
  return new Response(null, { status: 204 })
})

// ── Participants ──────────────────────────────────────────────────────────────

data.post('/games/:id/participants', async (c) => {
  const gameId = Number(c.req.param('id'))
  const { playerName } = await c.req.json<{ playerName: string }>()
  const [row] = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO participants (game_id, player_name) VALUES (?, ?) RETURNING id, game_id as gameId, player_name as playerName, is_active as isActive, created_at as createdAt`
    ).bind(gameId, playerName),
    c.env.DB.prepare(`UPDATE games SET participant_count = participant_count + 1 WHERE id = ?`).bind(gameId),
  ])
  return c.json(mapParticipant(row.results[0] as Record<string, unknown>), 201)
})

// ── Picks ─────────────────────────────────────────────────────────────────────

data.put('/picks', async (c) => {
  const body = await c.req.json<{
    id?: number; gameId: number; roundId: number; playerName: string
    teamId?: number; teamName?: string; result?: string; autoAssigned: boolean
  }>()

  // Players can only submit picks for themselves
  const userRole = c.get('userRole')
  const userName = c.get('userName')
  if (userRole === 'player' && body.playerName !== userName) {
    return c.json({ error: 'Players can only submit their own picks' }, 403)
  }

  const row = await c.env.DB.prepare(`
    INSERT INTO picks (game_id, round_id, player_name, team_id, team_name, result, auto_assigned)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (game_id, round_id, player_name) DO UPDATE SET
      team_id = excluded.team_id, team_name = excluded.team_name,
      result = excluded.result, auto_assigned = excluded.auto_assigned
    RETURNING id, game_id as gameId, round_id as roundId, player_name as playerName,
              team_id as teamId, team_name as teamName, result, auto_assigned as autoAssigned,
              created_at as createdAt
  `).bind(
    body.gameId, body.roundId, body.playerName,
    body.teamId ?? null, body.teamName ?? null,
    body.result ?? null, body.autoAssigned ? 1 : 0
  ).first<Record<string, unknown>>()

  return c.json(mapPick(row!))
})

data.delete('/picks/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM picks WHERE id = ?').bind(id).run()
  return new Response(null, { status: 204 })
})

// ── Round advancement ─────────────────────────────────────────────────────────

data.post('/games/:id/advance', async (c) => {
  const gameId = Number(c.req.param('id'))
  const body = await c.req.json<{
    currentRound: number; openRoundId: number
    eliminatedParticipantIds: number[]; nextRoundNumber: number | null; winnerNames?: string[]
  }>()

  const stmts = [
    ...body.eliminatedParticipantIds.map(pid =>
      c.env.DB.prepare(`UPDATE participants SET is_active = 0, eliminated_in_round = ? WHERE id = ?`).bind(body.currentRound, pid)
    ),
    c.env.DB.prepare(`UPDATE rounds SET status = 'closed' WHERE id = ?`).bind(body.openRoundId),
    body.nextRoundNumber === null
      ? c.env.DB.prepare(`UPDATE games SET status = 'completed', winner_name = ? WHERE id = ?`).bind(body.winnerNames?.join(', ') ?? null, gameId)
      : c.env.DB.prepare(`UPDATE games SET current_round = ? WHERE id = ?`).bind(body.nextRoundNumber, gameId),
    ...(body.nextRoundNumber !== null ? [
      c.env.DB.prepare(`INSERT INTO rounds (game_id, round_number, status) VALUES (?, ?, 'open')`).bind(gameId, body.nextRoundNumber),
    ] : []),
  ]

  await c.env.DB.batch(stmts)
  const game = await c.env.DB.prepare(`${GAME_SELECT} WHERE g.id = ?`).bind(gameId).first<Record<string, unknown>>()
  return c.json(mapGame(game!))
})

data.post('/games/:id/rollover', async (c) => {
  const gameId = Number(c.req.param('id'))
  const body = await c.req.json<{ currentRound: number; openRoundId: number; rolloverMode: 'round' | 'game' }>()

  const stmts = [
    c.env.DB.prepare(`UPDATE participants SET is_active = 1, eliminated_in_round = NULL WHERE game_id = ?`).bind(gameId),
    c.env.DB.prepare(`UPDATE games SET status = 'active', winner_name = NULL WHERE id = ?`).bind(gameId),
    ...(body.rolloverMode === 'game' ? [
      c.env.DB.prepare(`DELETE FROM picks WHERE game_id = ?`).bind(gameId),
      c.env.DB.prepare(`DELETE FROM rounds WHERE game_id = ?`).bind(gameId),
      c.env.DB.prepare(`INSERT INTO rounds (game_id, round_number, status) VALUES (?, 1, 'open')`).bind(gameId),
      c.env.DB.prepare(`UPDATE games SET current_round = 1 WHERE id = ?`).bind(gameId),
    ] : [
      c.env.DB.prepare(`UPDATE rounds SET status = 'closed' WHERE id = ?`).bind(body.openRoundId),
      c.env.DB.prepare(`DELETE FROM picks WHERE round_id = ?`).bind(body.openRoundId),
      c.env.DB.prepare(`INSERT INTO rounds (game_id, round_number, status) VALUES (?, ?, 'open')`).bind(gameId, body.currentRound),
    ]),
  ]

  await c.env.DB.batch(stmts)
  const game = await c.env.DB.prepare(`${GAME_SELECT} WHERE g.id = ?`).bind(gameId).first<Record<string, unknown>>()
  return c.json(mapGame(game!))
})

// ── Sync ──────────────────────────────────────────────────────────────────────

data.get('/sync', async (c) => {
  const [groups, teams, players] = await Promise.all([
    c.env.DB.prepare(`SELECT g.id, g.name, g.created_at as createdAt, COUNT(t.id) as teamCount FROM groups g LEFT JOIN teams t ON t.group_id = g.id GROUP BY g.id ORDER BY g.created_at`).all<Group>(),
    c.env.DB.prepare(`SELECT id, group_id as groupId, name, external_id as externalId, crest_url as crestUrl, created_at as createdAt FROM teams ORDER BY name`).all<Team>(),
    c.env.DB.prepare(`SELECT id, name, created_at as createdAt FROM players ORDER BY name`).all<Player>(),
  ])

  let gameRows: Record<string, unknown>[] = []
  let participantRows: Record<string, unknown>[] = []
  let roundRows: Round[] = []
  let pickRows: Record<string, unknown>[] = []

  const role = c.get('userRole')
  const userId = c.get('userId')
  const userName = c.get('userName')

  if (role === 'admin') {
    ;[gameRows, participantRows, roundRows, pickRows] = await Promise.all([
      c.env.DB.prepare(`${GAME_SELECT} ORDER BY g.created_at DESC`).all<Record<string, unknown>>().then(r => r.results),
      c.env.DB.prepare(`SELECT id, game_id as gameId, player_name as playerName, is_active as isActive, eliminated_in_round as eliminatedInRound, created_at as createdAt FROM participants`).all<Record<string, unknown>>().then(r => r.results),
      c.env.DB.prepare(`SELECT id, game_id as gameId, round_number as roundNumber, status, created_at as createdAt FROM rounds`).all<Round>().then(r => r.results),
      c.env.DB.prepare(`SELECT id, game_id as gameId, round_id as roundId, player_name as playerName, team_id as teamId, team_name as teamName, result, auto_assigned as autoAssigned, created_at as createdAt FROM picks`).all<Record<string, unknown>>().then(r => r.results),
    ]) as [Record<string, unknown>[], Record<string, unknown>[], Round[], Record<string, unknown>[]]
  } else {
    // Manager: union of managed games + games they're a participant in
    // Player: games they're a participant in
    const idQueries: Promise<{ id: number }[]>[] = [
      c.env.DB.prepare(`SELECT DISTINCT game_id as id FROM participants WHERE player_name = ?`).bind(userName).all<{ id: number }>().then(r => r.results),
    ]
    if (role === 'manager') {
      idQueries.push(
        c.env.DB.prepare(`SELECT id FROM games WHERE manager_id = ?`).bind(userId).all<{ id: number }>().then(r => r.results)
      )
    }
    const idSets = await Promise.all(idQueries)
    const ids = [...new Set(idSets.flat().map(r => r.id))]

    if (ids.length > 0) {
      const ph = ids.map(() => '?').join(',')
      ;[gameRows, participantRows, roundRows, pickRows] = await Promise.all([
        c.env.DB.prepare(`${GAME_SELECT} WHERE g.id IN (${ph}) ORDER BY g.created_at DESC`).bind(...ids).all<Record<string, unknown>>().then(r => r.results),
        c.env.DB.prepare(`SELECT id, game_id as gameId, player_name as playerName, is_active as isActive, eliminated_in_round as eliminatedInRound, created_at as createdAt FROM participants WHERE game_id IN (${ph})`).bind(...ids).all<Record<string, unknown>>().then(r => r.results),
        c.env.DB.prepare(`SELECT id, game_id as gameId, round_number as roundNumber, status, created_at as createdAt FROM rounds WHERE game_id IN (${ph})`).bind(...ids).all<Round>().then(r => r.results),
        c.env.DB.prepare(`SELECT id, game_id as gameId, round_id as roundId, player_name as playerName, team_id as teamId, team_name as teamName, result, auto_assigned as autoAssigned, created_at as createdAt FROM picks WHERE game_id IN (${ph})`).bind(...ids).all<Record<string, unknown>>().then(r => r.results),
      ]) as [Record<string, unknown>[], Record<string, unknown>[], Round[], Record<string, unknown>[]]
    }
  }

  return c.json({
    groups: groups.results,
    teams: teams.results,
    players: players.results,
    games: gameRows.map(mapGame),
    participants: participantRows.map(mapParticipant),
    rounds: roundRows,
    picks: pickRows.map(mapPick),
  })
})

export default data
