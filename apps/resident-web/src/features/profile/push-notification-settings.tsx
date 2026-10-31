'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@block9/api-client'
import { useResidentAuth } from '../../app/auth-provider'

type Preferences = {
  language: 'en' | 'te'
  noticesEnabled: boolean
  pollsEnabled: boolean
  complaintsEnabled: boolean
  resetEmailEnabled: boolean
}
type Settings = { publicKey: string | null; preferences: Preferences; deviceCount: number; supported: boolean }

const defaults: Preferences = {
  language: 'en', noticesEnabled: true, pollsEnabled: true, complaintsEnabled: true, resetEmailEnabled: false,
}

function applicationServerKey(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = globalThis.atob(base64 + '='.repeat((4 - base64.length % 4) % 4))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function installedAsIosApp() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as globalThis.Navigator & { standalone?: boolean }).standalone)
}

function iosVersionSupported() {
  const match = navigator.userAgent.match(/OS (\d+)[._](\d+)/)
  return !match || Number(match[1]) > 16 || (Number(match[1]) === 16 && Number(match[2]) >= 4)
}

export function PushNotificationSettings() {
  const { activeTenantId, isAuthenticated } = useResidentAuth()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [deviceEnabled, setDeviceEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    if (!activeTenantId || !isAuthenticated) {
      setSettings(null)
      setDeviceEnabled(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const value = await apiFetch<Settings>('/v1/tenant/push/settings', {
        headers: { 'X-Tenant-Id': activeTenantId },
      })
      setSettings(value)
      if ('serviceWorker' in navigator && 'PushManager' in globalThis) {
        const registration = await navigator.serviceWorker.ready
        setDeviceEnabled(Boolean(await registration.pushManager.getSubscription()))
      } else setDeviceEnabled(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Notification settings could not be loaded.')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [activeTenantId, isAuthenticated])

  const save = async (preferences: Preferences) => {
    if (!activeTenantId || busy) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      await apiFetch('/v1/tenant/push/preferences', {
        method: 'PATCH',
        headers: { 'X-Tenant-Id': activeTenantId, 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      })
      setSettings((current) => current ? { ...current, preferences } : current)
      setMessage('Notification preferences saved.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Notification preferences could not be saved.')
    } finally { setBusy(false) }
  }

  const enable = async () => {
    if (!settings?.publicKey || !activeTenantId || busy) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in globalThis) || !('Notification' in globalThis)) {
        setMessage('Push notifications are not supported by this browser.')
        return
      }
      const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      if (isIos && (!iosVersionSupported() || !installedAsIosApp())) {
        setMessage('On iPhone or iPad, install this app on your Home Screen and use iOS 16.4 or later to enable notifications.')
        return
      }
      const permission = await globalThis.Notification.requestPermission()
      if (permission !== 'granted') {
        setMessage(permission === 'denied' ? 'Notifications are blocked in browser settings.' : 'Notification permission was not granted.')
        return
      }
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(settings.publicKey),
      })
      await apiFetch('/v1/tenant/push/subscriptions', {
        method: 'POST',
        headers: { 'X-Tenant-Id': activeTenantId, 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })
      setMessage('Notifications are enabled on this device.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Notifications could not be enabled.')
    } finally { setBusy(false) }
  }

  const disable = async () => {
    if (busy) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription && activeTenantId) {
        await apiFetch('/v1/tenant/push/subscriptions', {
          method: 'DELETE',
          headers: { 'X-Tenant-Id': activeTenantId, 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        await subscription.unsubscribe()
        setDeviceEnabled(false)
      }
      setMessage('Notifications are disabled on this device.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This device could not be unregistered.')
    } finally { setBusy(false) }
  }

  const updatePreference = (key: keyof Preferences, value: boolean | 'en' | 'te') => {
    const preferences = { ...(settings?.preferences ?? defaults), [key]: value } as Preferences
    void save(preferences)
  }

  return <section className="card section-stack" aria-busy={loading || busy}>
    <h3>Push notifications</h3>
    <p>Choose the community updates you want on this device. Notification previews never include private content.</p>
    {loading && <p role="status">Loading notification settings…</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {settings && <>
      {!settings.supported
        ? <p>Push notifications are not configured for this service.</p>
        : deviceEnabled
          ? <><button className="secondary" type="button" disabled={busy} onClick={() => void enable()}>Enable or reassign this device</button><button className="secondary" type="button" disabled={busy} onClick={() => void disable()}>Disable on this device</button></>
          : <button className="secondary" type="button" disabled={busy} onClick={() => void enable()}>Enable notifications on this device</button>}
      <label>Notification language
        <select disabled={busy} value={settings.preferences.language} onChange={(event) => updatePreference('language', event.target.value as 'en' | 'te')}>
          <option value="en">English</option><option value="te">తెలుగు</option>
        </select>
      </label>
      <label><input type="checkbox" disabled={busy} checked={settings.preferences.noticesEnabled} onChange={(event) => updatePreference('noticesEnabled', event.target.checked)}/> Notices</label>
      <label><input type="checkbox" disabled={busy} checked={settings.preferences.pollsEnabled} onChange={(event) => updatePreference('pollsEnabled', event.target.checked)}/> Polls</label>
      <label><input type="checkbox" disabled={busy} checked={settings.preferences.complaintsEnabled} onChange={(event) => updatePreference('complaintsEnabled', event.target.checked)}/> Complaint status changes</label>
      <label><input type="checkbox" disabled={busy} checked={settings.preferences.resetEmailEnabled} onChange={(event) => updatePreference('resetEmailEnabled', event.target.checked)}/> Email me about passkey reset alerts</label>
      <small>{settings.deviceCount} of 5 devices registered in this community. A passkey reset alert overrides push category preferences.</small>
    </>}
  </section>
}
