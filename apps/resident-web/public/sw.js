// Private records and authenticated documents are network-only. No write queue.
self.addEventListener('install', () => {})
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting()
})
self.addEventListener('push', (event) => {
  const parsed = (() => {
    try { return event.data?.json() } catch { return null }
  })()
  const valid = parsed && ['notice', 'poll', 'passkey-reset', 'complaint-status-change'].includes(parsed.type) &&
    typeof parsed.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)
  const language = parsed?.language === 'te' ? 'te' : 'en'
  const copy = {
    en: {
      notice: ['Community update', 'A new notice is available.'],
      poll: ['Community poll', 'A new poll is available.'],
      'passkey-reset': ['Account security alert', 'A passkey reset was initiated for your account.'],
      'complaint-status-change': ['Complaint update', 'A complaint status has changed.'],
      generic: ['MyApartment', 'You have a new community notification.'],
    },
    te: {
      notice: ['కమ్యూనిటీ సమాచారం', 'కొత్త ప్రకటన అందుబాటులో ఉంది.'],
      poll: ['కమ్యూనిటీ పోల్', 'కొత్త పోల్ అందుబాటులో ఉంది.'],
      'passkey-reset': ['ఖాతా భద్రతా హెచ్చరిక', 'మీ ఖాతా కోసం పాస్‌కీ రీసెట్ ప్రారంభించబడింది.'],
      'complaint-status-change': ['ఫిర్యాదు నవీకరణ', 'ఫిర్యాదు స్థితి మారింది.'],
      generic: ['MyApartment', 'మీకు కొత్త కమ్యూనిటీ నోటిఫికేషన్ ఉంది.'],
    },
  }
  const text = valid ? copy[language][parsed.type] : copy.en.generic
  const notification = self.registration.showNotification(text[0], {
    body: text[1],
    tag: valid ? `myapartment:${parsed.type}:${parsed.id}` : 'myapartment:generic',
    renotify: false,
    silent: false,
    lang: language === 'te' ? 'te-IN' : 'en-IN',
    data: valid ? { type: parsed.type, id: parsed.id } : null,
  })
  event.waitUntil(Promise.all([
    notification,
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (!valid) return
      for (const client of clients) client.postMessage({ type: 'RESIDENT_PUSH_RECEIVED', eventType: parsed.type, id: parsed.id })
    }),
  ]))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data
  const id = typeof data?.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id) ? data.id : ''
  const paths = {
    notice: id ? `/?push=notice&id=${encodeURIComponent(id)}` : '/',
    poll: id ? `/?push=poll&id=${encodeURIComponent(id)}` : '/',
    'passkey-reset': '/security/passkeys',
    'complaint-status-change': id ? `/?push=complaint-status-change&id=${encodeURIComponent(id)}` : '/',
  }
  const path = typeof data?.type === 'string' && Object.hasOwn(paths, data.type) ? paths[data.type] : '/'
  const target = new URL(path, self.location.origin)
  if (target.origin !== self.location.origin) return
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin) {
        try {
          await client.navigate(target.href)
          return client.focus()
        } catch { break }
      }
    }
    return self.clients.openWindow(target.href)
  }))
})
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET') return
  event.respondWith(fetch(event.request).catch(() => new Response(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>You’re offline</title><style>body{margin:0;background:#f5f7fa;color:#152337;font:16px/1.6 system-ui,sans-serif}main{max-width:36rem;margin:15vh auto;padding:24px}a{display:inline-block;padding:12px 20px;border-radius:10px;background:#3946a5;color:white}h1{font-size:28px}</style>
<main><h1>You’re offline</h1><p>Connect to the internet to open your community app. Private records are not stored on this device for offline access.</p><p>If a save was interrupted, check the record after reconnecting before trying again.</p><a href="/">Try again</a></main></html>`, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })))
})
