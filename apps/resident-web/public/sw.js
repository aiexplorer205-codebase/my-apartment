self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
// Authenticated pages and API responses are always fetched from the network.
self.addEventListener('fetch', () => {})
