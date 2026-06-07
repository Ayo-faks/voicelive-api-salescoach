/* Pathfinder Learn — W8 service worker.
 *
 * Receives Web Push deliveries dispatched by
 * `python -m src.learning.notifications_dispatcher` and surfaces them as
 * desktop notifications. Tapping a notification deep-links to
 * `/practice/{topic_id}`, focusing an existing tab when possible.
 */

self.addEventListener('install', event => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', event => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (err) {
    data = { title: 'Wulo Academy', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Time for a quick check-in'
  const options = {
    body: data.body || 'Tap to continue your revision.',
    icon: '/wulo-logo.png?v=4',
    badge: '/favicon.ico?v=4',
    tag: data.card_id || data.topic_id || 'pathfinder-revision',
    data: {
      url: data.url || (data.topic_id ? `/practice/${data.topic_id}` : '/home'),
      cardId: data.card_id,
      topicId: data.topic_id,
    },
    renotify: true,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/home'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        for (const client of clients) {
          try {
            const url = new URL(client.url)
            if (url.origin === self.location.origin && 'focus' in client) {
              client.postMessage({ type: 'pathfinder:notification-click', target })
              return client.focus().then(c => c.navigate ? c.navigate(target) : c)
            }
          } catch (_err) {
            // ignore non-http clients
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(target)
        }
        return null
      })
  )
})
