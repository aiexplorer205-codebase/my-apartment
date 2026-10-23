// Private records and authenticated documents are network-only. No write queue.
self.addEventListener('install', () => {})
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting()
})
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET') return
  event.respondWith(fetch(event.request).catch(() => new Response(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>You’re offline</title><style>body{margin:0;background:#f5f7fa;color:#152337;font:16px/1.6 system-ui,sans-serif}main{max-width:36rem;margin:15vh auto;padding:24px}a{display:inline-block;padding:12px 20px;border-radius:10px;background:#3946a5;color:white}h1{font-size:28px}</style>
<main><h1>You’re offline</h1><p>Connect to the internet to open your community app. Private records are not stored on this device for offline access.</p><p>If a save was interrupted, check the record after reconnecting before trying again.</p><a href="/">Try again</a></main></html>`, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })))
})
