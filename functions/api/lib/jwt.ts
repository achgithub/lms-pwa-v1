export interface JwtPayload {
  sub: number
  name: string
  role: 'admin' | 'manager' | 'player'
  exp: number
}

function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4)
  const binary = atob(padded)
  return new Uint8Array([...binary].map(c => c.charCodeAt(0)))
}

function bytesToBase64url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  )
}

export async function signJWT(payload: Omit<JwtPayload, never>, secret: string): Promise<string> {
  const header = bytesToBase64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body   = bytesToBase64url(new TextEncoder().encode(JSON.stringify(payload)))
  const key    = await hmacKey(secret, 'sign')
  const sig    = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`))
  return `${header}.${body}.${bytesToBase64url(sig)}`
}

export async function verifyJWT(token: string, secret: string): Promise<JwtPayload> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Malformed token')

  const [header, body, sig] = parts
  const key   = await hmacKey(secret, 'verify')
  const valid = await crypto.subtle.verify(
    'HMAC', key,
    base64urlToBytes(sig),
    new TextEncoder().encode(`${header}.${body}`)
  )
  if (!valid) throw new Error('Invalid signature')

  const payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(body))) as JwtPayload
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired')

  return payload
}
