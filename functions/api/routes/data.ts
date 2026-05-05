import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types'
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

data.post('/groups', async (c) => {
  const { name } = await c.req.json<{ name: string }>()
  if (!name?.trim()) return c.json({ error: 'name required' }, 400)
  const row = await c.env.DB.prepare(
    `INSERT INTO groups (name, manager_id) VALUES (?, ?) RETURNING id, name, created_at as createdAt`
  ).bind(name.trim(), c.get('userId')).first<Omit<Group, 'teamCount'>>()
  return c.json({ ...row, teamCount: 0 } as Group, 201)
})

data.delete('/groups/:id', async (c) => {
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
    `SELECT id, group_id as groupId, name, created_at as createdAt FROM teams WHERE group_id = ? ORDER BY name`
  ).bind(groupId).all<Team>()
  return c.json(results)
})

data.post('/groups/:groupId/teams', async (c) => {
  const groupId = Number(c.req.param('groupId'))
  const { name } = await c.req.json<{ name: string }>()
  if (!name?.trim()) return c.json({ error: 'name required' }, 400)
  const row = await c.env.DB.prepare(
    `INSERT INTO teams (group_id, name) VALUES (?, ?) RETURNING id, group_id as groupId, name, created_at as createdAt`
  ).bind(groupId, name.trim()).first<Team>()
  return c.json(row, 201)
})

data.delete('/teams/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(id).run()
  return new Response(null, { status: 204 })
})

// ── Players ───────────────────────────────────────────────────────────────────

data.get('/players', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, created_at as createdAt FROM players ORDER BY name`
  ).all<Player>()
  return c.json(results)
})

data.post('/players', async (c) => {
  const { name } = await c.req.json<{ name: string }>()
  if (!name?.trim()) return c.json({ error: 'name required' }, 400)
  const row = await c.env.DB.prepare(
    `INSERT INTO players (name) VALUES (?) RETURNING id, name, created_at as createdAt`
  ).bind(name.trim()).first<Player>()
  return c.json(row, 201)
})

data.delete('/players/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM players WHERE id = ?').bind(id).run()
  return new Response(null, { status: 204 })
})

// ── Games ─────────────────────────────────────────────────────────────────────

data.get('/games', async (c) => {
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
  const game = await c.env.DB.prepare(`${GAME_SELECT} WHERE g.id = ?`).bind(id).first<Record<string, unknown>>()
  if (!game) return c.json({ error: 'not found' }, 404)

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
  const [groups, teams, players, games, participants, rounds, picks] = await Promise.all([
    c.env.DB.prepare(`SELECT g.id, g.name, g.created_at as createdAt, COUNT(t.id) as teamCount FROM groups g LEFT JOIN teams t ON t.group_id = g.id GROUP BY g.id ORDER BY g.created_at`).all<Group>(),
    c.env.DB.prepare(`SELECT id, group_id as groupId, name, created_at as createdAt FROM teams ORDER BY name`).all<Team>(),
    c.env.DB.prepare(`SELECT id, name, created_at as createdAt FROM players ORDER BY name`).all<Player>(),
    c.env.DB.prepare(`${GAME_SELECT} ORDER BY g.created_at DESC`).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT id, game_id as gameId, player_name as playerName, is_active as isActive, eliminated_in_round as eliminatedInRound, created_at as createdAt FROM participants`).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT id, game_id as gameId, round_number as roundNumber, status, created_at as createdAt FROM rounds`).all<Round>(),
    c.env.DB.prepare(`SELECT id, game_id as gameId, round_id as roundId, player_name as playerName, team_id as teamId, team_name as teamName, result, auto_assigned as autoAssigned, created_at as createdAt FROM picks`).all<Record<string, unknown>>(),
  ])

  return c.json({
    groups: groups.results,
    teams: teams.results,
    players: players.results,
    games: games.results.map(mapGame),
    participants: participants.results.map(mapParticipant),
    rounds: rounds.results,
    picks: picks.results.map(mapPick),
  })
})

export default data
