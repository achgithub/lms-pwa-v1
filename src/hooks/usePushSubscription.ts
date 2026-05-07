import { useEffect, useState } from 'react'
import { api } from '../api/client'

function b64urlToBytes(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  const buf = new ArrayBuffer(binary.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i)
  return view
}

const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window

export function usePushSubscription() {
  const [permission, setPermission] = useState<NotificationPermission>(
    supported ? Notification.permission : 'denied'
  )
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setSubscribed(!!sub))
      .catch(() => {})
  }, [])

  async function enable() {
    if (!supported || busy) return
    setBusy(true)
    try {
      const { key } = await api.get<{ key: string }>('/push/vapid-public-key')
      const reg = await navigator.serviceWorker.ready

      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission()
        setPermission(perm)
        if (perm !== 'granted') return
      }

      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64urlToBytes(key).buffer.slice(0) as ArrayBuffer,
        })
      }

      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
      await api.post('/push/subscribe', {
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      })
      setPermission('granted')
      setSubscribed(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    if (!supported || busy) return
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
        await api.delete('/push/subscribe', { endpoint: json.endpoint })
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } catch {
      // Non-fatal
    } finally {
      setBusy(false)
    }
  }

  return { supported, permission, subscribed, busy, error, enable, disable }
}
