export type Role = 'admin' | 'manager' | 'player'

export type Bindings = {
  DB: D1Database
  JWT_SECRET: string
  SYNC_SECRET?: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY_JWK?: string
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
