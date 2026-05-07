export type Role = 'admin' | 'manager' | 'player'

export type Bindings = {
  DB: D1Database
  JWT_SECRET: string
  FOOTBALL_DATA_API_KEY: string
  SYNC_SECRET?: string
}

export type Variables = {
  userId: number
  userName: string
  userRole: Role
}

export type HonoEnv = {
  Bindings: Bindings
  Variables: Variables
}
