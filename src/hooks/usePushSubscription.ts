import { useEffect, useRef } from 'react'
import { api } from '../api/client'

function b64urlToBytes(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  const buf = new ArrayBuffer(binary.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i)
  return view
}

export function usePushSubscription() {
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (Notification.permission === 'denied') return

    attempted.current = true

    ;(async () => {
      try {
        const { key } = await api.get<{ key: string }>('/push/vapid-public-key')

        const reg = await navigator.serviceWorker.ready
        let sub = await reg.pushManager.getSubscription()

        if (!sub) {
          if (Notification.permission === 'default') {
            const perm = await Notification.requestPermission()
            if (perm !== 'granted') return
          }
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
      } catch {
        // Non-fatal — user just won't get push notifications
      }
    })()
  }, [])
}
