interface Env {
  DB: D1Database
  FOOTBALL_DATA_API_KEY: string
}

interface FDMatch {
  id: number
  matchday: number
  utcDate: string
  status: string
  homeTeam: { id: number; name: string }
  awayTeam: { id: number; name: string }
  score: {
    winner: string | null
    fullTime: { home: number | null; away: number | null }
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const today = new Date()
    const dateFrom = new Date(today)
    dateFrom.setDate(today.getDate() - 20)
    const dateTo = new Date(today)
    dateTo.setDate(today.getDate() + 60)

    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const url = `https://api.football-data.org/v4/competitions/PL/matches?dateFrom=${fmt(dateFrom)}&dateTo=${fmt(dateTo)}`

    const res = await fetch(url, {
      headers: {
        'X-Auth-Token': env.FOOTBALL_DATA_API_KEY,
        'Origin': 'https://lms-pwa-v1.pages.dev',
        'Referer': 'https://lms-pwa-v1.pages.dev/',
      },
    })

    if (!res.ok) {
      console.error(`football-data.org fetch failed: ${res.status} ${res.statusText}`)
      return
    }

    const { matches } = await res.json<{ matches: FDMatch[] }>()
    const now = new Date().toISOString()

    const stmts = matches.map((m) =>
      env.DB.prepare(`
        INSERT INTO fixtures (id, matchday, utc_date, status, home_team_name, away_team_name, home_score, away_score, winner, last_synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status         = excluded.status,
          home_score     = excluded.home_score,
          away_score     = excluded.away_score,
          winner         = excluded.winner,
          last_synced    = excluded.last_synced
      `).bind(
        m.id,
        m.matchday,
        m.utcDate,
        m.status,
        m.homeTeam.name,
        m.awayTeam.name,
        m.score.fullTime.home ?? null,
        m.score.fullTime.away ?? null,
        m.score.winner ?? null,
        now,
      )
    )

    // D1 batch limit is 100
    for (let i = 0; i < stmts.length; i += 100) {
      await env.DB.batch(stmts.slice(i, i + 100))
    }

    console.log(`Synced ${matches.length} PL fixtures (matchdays ${[...new Set(matches.map((m) => m.matchday))].join(', ')})`)
  },
}
