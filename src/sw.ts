/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (event) => {
  if (!event.data) return
  const { title, body } = event.data.json() as { title: string; body: string }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/pwa-192x192.svg',
      badge: '/icons/pwa-192x192.svg',
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => c.url.startsWith(self.location.origin))
      if (open) return open.focus()
      return self.clients.openWindow('/')
    })
  )
})
