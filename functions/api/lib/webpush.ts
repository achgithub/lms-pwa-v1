// Web Push encryption (RFC 8291) and VAPID JWT signing (RFC 8292) using Web Crypto API.

function b64url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function b64urlToBytes(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  return new Uint8Array([...binary].map(c => c.charCodeAt(0)))
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8)
  return new Uint8Array(bits)
}

async function signVapidJwt(privateKeyJwk: JsonWebKey, audience: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'jwk', privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  )
  const enc = (obj: unknown) => b64url(new TextEncoder().encode(JSON.stringify(obj)))
  const header  = enc({ alg: 'ES256', typ: 'JWT' })
  const payload = enc({ aud: audience, exp: Math.floor(Date.now() / 1000) + 43200, sub: 'mailto:push@lms' })
  const unsigned = `${header}.${payload}`
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned),
  )
  return `${unsigned}.${b64url(new Uint8Array(sig))}`
}

async function buildBody(payload: string, p256dh: string, auth: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const authBytes    = b64urlToBytes(auth)
  const receiverPub  = b64urlToBytes(p256dh)

  const senderPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderPair.publicKey))

  const receiverKey = await crypto.subtle.importKey('raw', receiverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, senderPair.privateKey, 256))

  const salt = crypto.getRandomValues(new Uint8Array(16))

  // RFC 8291: PRK = HKDF(salt=auth, IKM=sharedSecret, info="WebPush: info\0" || ua_pub || as_pub)
  const prk   = await hkdf(sharedSecret, authBytes, concat(enc.encode('WebPush: info\x00'), receiverPub, senderPubRaw), 32)
  const cek   = await hkdf(prk, salt, enc.encode('Content-Encoding: aes128gcm\x00'), 16)
  const nonce = await hkdf(prk, salt, enc.encode('Content-Encoding: nonce\x00'), 12)

  // Encrypt: plaintext + 0x02 (last-record delimiter), AES-128-GCM
  const plaintext = concat(enc.encode(payload), new Uint8Array([2]))
  const aesKey    = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext))

  // RFC 8188 header: salt(16) | rs(4 BE) | idlen(1) | sender_pub(65)
  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, 4096, false)

  return concat(salt, rs, new Uint8Array([senderPubRaw.length]), senderPubRaw, ciphertext)
}

export class PushGoneError extends Error {
  constructor(public endpoint: string) { super('Subscription gone') }
}

export interface PushSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

export async function sendPush(
  sub: PushSubscription,
  message: { title: string; body: string },
  vapidPublicKey: string,
  vapidPrivateKeyJwk: JsonWebKey,
): Promise<void> {
  const url = new URL(sub.endpoint)
  const audience = `${url.protocol}//${url.host}`
  const jwt  = await signVapidJwt(vapidPrivateKeyJwk, audience)
  const body = await buildBody(JSON.stringify(message), sub.p256dh, sub.auth)

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt},k=${vapidPublicKey}`,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
    },
    body,
  })

  if (res.status === 404 || res.status === 410) throw new PushGoneError(sub.endpoint)
  if (res.status !== 201 && !res.ok) throw new Error(`Push failed ${res.status}`)
}
