'use client'

import { useEffect, useRef, useState } from 'react'

type InstallPrompt = globalThis.Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Network-only private app: never caches authenticated pages or queues writes. */
export function PwaControls({ appName = 'MyApartment' }: { appName?: string }) {
  const controls=useRef<globalThis.HTMLDetailsElement>(null)
  const [online, setOnline] = useState(true)
  const [reconnected, setReconnected] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)
  const [waiting, setWaiting] = useState<globalThis.ServiceWorker | null>(null)
  const [installing, setInstalling] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let disposed = false
    let registration: globalThis.ServiceWorkerRegistration | undefined
    let candidate: globalThis.ServiceWorker | null = null
    const standalone = window.matchMedia('(display-mode: standalone)')
    setInstalled(standalone.matches || Boolean((navigator as globalThis.Navigator & { standalone?: boolean }).standalone))
    setOnline(navigator.onLine)
    const offline = () => { setOnline(false); setReconnected(false) }
    const connected = () => { setOnline(true); setReconnected(true) }
    const prompt = (event: globalThis.Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt) }
    const appInstalled = () => { setInstalled(true); setInstallPrompt(null) }
    const stateChanged = () => {
      if (!disposed && candidate?.state === 'installed' && navigator.serviceWorker.controller) setWaiting(registration?.waiting ?? candidate)
    }
    const updateFound = () => {
      candidate?.removeEventListener('statechange', stateChanged)
      candidate = registration?.installing ?? null
      candidate?.addEventListener('statechange', stateChanged)
    }
    const openInstall=()=>{if(controls.current){controls.current.open=true;controls.current.scrollIntoView({block:'start'});controls.current.querySelector('summary')?.focus()}}
    window.addEventListener('myapartment:open-install',openInstall)
    window.addEventListener('offline', offline)
    window.addEventListener('online', connected)
    window.addEventListener('beforeinstallprompt', prompt)
    window.addEventListener('appinstalled', appInstalled)
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').then((result) => {
        if (disposed) return
        registration = result
        setWaiting(result.waiting)
        result.addEventListener('updatefound', updateFound)
        updateFound()
      }).catch(() => { if (!disposed) setMessage('App installation is unavailable. You can continue in your browser.') })
    }
    return () => {
      disposed = true
      window.removeEventListener('myapartment:open-install',openInstall)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', connected)
      window.removeEventListener('beforeinstallprompt', prompt)
      window.removeEventListener('appinstalled', appInstalled)
      registration?.removeEventListener('updatefound', updateFound)
      candidate?.removeEventListener('statechange', stateChanged)
    }
  }, [])

  const install = async () => {
    if (!installPrompt || installing) return
    setInstalling(true)
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      setMessage(choice.outcome === 'accepted' ? 'Installation requested. Follow your browser’s instructions.' : 'Installation dismissed. You can continue in your browser.')
      setInstallPrompt(null)
    } catch {
      setMessage('Installation could not start. Use your browser’s installation menu.')
    } finally { setInstalling(false) }
  }

  const update = () => {
    // Do not activate/reload while a form may contain a private draft or a request is pending.
    const busy = document.querySelector('form, [aria-busy="true"], button[type="submit"]:disabled')
    if (busy) { setMessage('Finish or close your current form before updating. Your work has been kept.'); return }
    if (!online) { setMessage('Reconnect before updating.'); return }
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
    waiting?.postMessage({ type: 'ACTIVATE_UPDATE' })
  }

  return <>
    {!online && <div className="pwa-status" role="alert"><p>You’re offline. Reconnect to view current records or save changes. If a save was interrupted, check the record before trying again.</p></div>}
    {reconnected && <div className="pwa-status" role="status"><p>Connection restored. Refresh the current view to check the latest records.</p><button type="button" onClick={() => setReconnected(false)}>Dismiss</button></div>}
    <details ref={controls} className="pwa-controls">
      <summary>{waiting ? 'App update available' : installed ? 'App installed · connection and updates' : `Install ${appName}`}</summary>
      {installed ? <p>{appName} is running as an installed app. Financial records and private information require a connection.</p> : installPrompt ? <><p>Add {appName} to your home screen for quick access.</p><button className="primary" type="button" disabled={installing || !online} onClick={() => void install()}>{installing ? 'Opening installer…' : 'Install app'}</button></> : <p>On iPhone or iPad, open this app in Safari, choose Share, then Add to Home Screen. In other supported browsers, use the browser menu’s Install app or Add to Home Screen option. Availability depends on your browser and device.</p>}
      {waiting && <><p>A new version is ready. Finish your current task before updating.</p><button className="primary" type="button" onClick={update}>Update and reload</button></>}
      {message && <p role="status">{message}</p>}
    </details>
  </>
}
