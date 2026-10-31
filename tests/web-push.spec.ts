import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import {
  createPushPayload,
  pushClickPath,
  pushStatusDisposition,
  pushTypeRegistry,
  residentVisibleEntityPushCoverage,
  validatePushEndpoint,
} from '../apps/api/src/push-service'

describe('Web Push boundaries', () => {
  it('accepts only HTTPS endpoints hosted by supported push providers', () => {
    expect(validatePushEndpoint('https://fcm.googleapis.com/fcm/send/opaque').hostname).toBe('fcm.googleapis.com')
    expect(validatePushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/opaque').hostname)
      .toBe('updates.push.services.mozilla.com')
    for (const endpoint of [
      'http://fcm.googleapis.com/path',
      'https://127.0.0.1/path',
      'https://[::1]/path',
      'https://localhost/path',
      'https://192.168.1.1/path',
      'https://attacker.example/path',
      'https://user:pass@fcm.googleapis.com/path',
      'https://fcm.googleapis.com:444/path',
    ]) expect(() => validatePushEndpoint(endpoint)).toThrow()
  })

  it('classifies expired provider endpoints for subscription cleanup', () => {
    expect(pushStatusDisposition(404)).toBe('gone')
    expect(pushStatusDisposition(410)).toBe('gone')
    expect(pushStatusDisposition(503)).toBe('failed')
    expect(pushTypeRegistry.notice).toMatchObject({ scope: 'community', ttl: 86_400, urgency: 'normal' })
    expect(pushTypeRegistry['passkey-reset']).toMatchObject({ scope: 'resident', ttl: 0, urgency: 'high' })
  })

  it('constructs minimal payloads and same-origin allowlisted click paths', () => {
    expect(createPushPayload('notice', '123e4567-e89b-42d3-a456-426614174000', 'te')).toEqual({
      type: 'notice', id: '123e4567-e89b-42d3-a456-426614174000', language: 'te',
    })
    expect(() => createPushPayload('notice', 'not-an-id', 'en')).toThrow()
    expect(pushClickPath('notice', '123e4567-e89b-42d3-a456-426614174000'))
      .toBe('/?push=notice&id=123e4567-e89b-42d3-a456-426614174000')
    expect(pushClickPath('passkey-reset', 'ignored')).toBe('/security/passkeys')
  })

  it('requires an explicit push policy for every documented resident-visible data entity', async () => {
    const architecture = await readFile(new URL('../docs/architecture.md', import.meta.url), 'utf8')
    const section = architecture.split('Current resident-visible data and its signal scope.')[1]
      ?.split('Every new resident-visible entity')[0] ?? ''
    const documentedEntities = [...section.matchAll(/`([a-z][a-z0-9_]+)`/g)]
      .map((match) => match[1]!)
      .filter((name) => name !== 'tenant_id' && name !== 'entity')
    for (const entity of new Set(documentedEntities)) {
      expect(Object.hasOwn(residentVisibleEntityPushCoverage, entity), `${entity} needs a push policy decision`).toBe(true)
    }
    for (const type of Object.values(residentVisibleEntityPushCoverage)) {
      if (type !== null) expect(Object.hasOwn(pushTypeRegistry, type)).toBe(true)
    }
  })
})

describe('resident service-worker push behavior', () => {
  type WorkerEvent = {
    data?: { json: () => unknown }
    notification?: { close: () => void; data: unknown }
    waitUntil: (promise: Promise<unknown>) => void
  }
  type ShownOptions = { body: string; tag: string; renotify: boolean; silent: boolean; lang: string; data: unknown }

  async function loadWorker() {
    const source = await readFile(new URL('../apps/resident-web/public/sw.js', import.meta.url), 'utf8')
    const listeners = new Map<string, (event: WorkerEvent) => void>()
    const shown: Array<{ title: string; options: ShownOptions }> = []
    const messages: unknown[] = []
    const focused = vi.fn()
    const client = {
      url: 'https://resident.example/',
      postMessage: (message: unknown) => messages.push(message),
      navigate: vi.fn(async () => undefined),
      focus: focused,
    }
    const self = {
      location: { origin: 'https://resident.example' },
      registration: { showNotification: vi.fn(async (title: string, options: ShownOptions) => { shown.push({ title, options }) }) },
      clients: {
        matchAll: vi.fn(async () => [client]),
        openWindow: vi.fn(async (url: string) => url),
        claim: vi.fn(),
      },
      addEventListener: (type: string, listener: (event: WorkerEvent) => void) => listeners.set(type, listener),
      skipWaiting: vi.fn(),
    }
    runInNewContext(source, { self, URL, Promise, Response: globalThis.Response, encodeURIComponent })
    return { listeners, shown, messages, self, client }
  }

  it('shows localized visible notifications with a type/event tag and messages open clients', async () => {
    const worker = await loadWorker()
    for (const language of ['en', 'te']) {
      let completion: Promise<unknown> | undefined
      worker.listeners.get('push')?.({
        data: { json: () => ({ type: 'notice', id: '123e4567-e89b-42d3-a456-426614174000', language }) },
        waitUntil: (promise: Promise<unknown>) => { completion = promise },
      })
      await completion
    }
    expect(worker.shown).toHaveLength(2)
    expect(worker.shown.map(({ title }) => title)).toEqual(['Community update', 'కమ్యూనిటీ సమాచారం'])
    expect(worker.shown.map(({ options }) => options.tag)).toEqual([
      'myapartment:notice:123e4567-e89b-42d3-a456-426614174000',
      'myapartment:notice:123e4567-e89b-42d3-a456-426614174000',
    ])
    expect(worker.shown.every(({ options }) => options.renotify === false && options.silent === false)).toBe(true)
    expect(worker.messages).toEqual([
      { type: 'RESIDENT_PUSH_RECEIVED', eventType: 'notice', id: '123e4567-e89b-42d3-a456-426614174000' },
      { type: 'RESIDENT_PUSH_RECEIVED', eventType: 'notice', id: '123e4567-e89b-42d3-a456-426614174000' },
    ])
  })

  it('shows a generic visible notification for malformed pushes without routing or messaging', async () => {
    const worker = await loadWorker()
    let completion: Promise<unknown> | undefined
    worker.listeners.get('push')?.({
      data: { json: () => ({ type: 'unknown', id: 'not-an-id', personal: 'must not be shown' }) },
      waitUntil: (promise: Promise<unknown>) => { completion = promise },
    })
    await completion
    expect(worker.shown).toEqual([{
      title: 'MyApartment',
      options: {
        body: 'You have a new community notification.',
        tag: 'myapartment:generic',
        renotify: false,
        silent: false,
        lang: 'en-IN',
        data: null,
      },
    }])
    expect(worker.messages).toEqual([])
  })

  it('uses only same-origin notification click destinations', async () => {
    const worker = await loadWorker()
    let completion: Promise<unknown> | undefined
    worker.listeners.get('notificationclick')?.({
      notification: { close: vi.fn(), data: { type: 'poll', id: '123e4567-e89b-42d3-a456-426614174000' } },
      waitUntil: (promise: Promise<unknown>) => { completion = promise },
    })
    await completion
    expect(worker.client.navigate).toHaveBeenCalledWith(
      'https://resident.example/?push=poll&id=123e4567-e89b-42d3-a456-426614174000',
    )
    expect(worker.client.focus).toHaveBeenCalledOnce()
  })

  it('routes passkey-reset clicks only to the passkey screen', async () => {
    const worker = await loadWorker()
    let completion: Promise<unknown> | undefined
    worker.listeners.get('notificationclick')?.({
      notification: { close: vi.fn(), data: { type: 'passkey-reset', id: '123e4567-e89b-42d3-a456-426614174000' } },
      waitUntil: (promise: Promise<unknown>) => { completion = promise },
    })
    await completion
    expect(worker.client.navigate).toHaveBeenCalledWith('https://resident.example/security/passkeys')
  })
})
