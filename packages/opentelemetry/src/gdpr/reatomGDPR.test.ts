
import { context, wrap } from '@reatom/core'
import { afterEach, expect, test, vi } from 'vitest'

import { reatomOpentelemetry } from '../reatomOpentelemetry.ts'
import { reatomGDPR } from './reatomGDPR.ts'

type OptionsWithConsent = {
  consent?: Record<string, boolean>
}

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const start = (
  overrides: Partial<Parameters<typeof reatomOpentelemetry>[0]> = {},
) => {
  const fetchMock = vi.fn<typeof globalThis.fetch>(
    async () => new Response('{}', { status: 200 }),
  )
  const otel = reatomOpentelemetry({
    name: `gdpr-${Math.random().toString(16).slice(2)}`,
    endpoint: null,
    serviceName: 'gdpr',
    skipGlobalExtension: true,
    fetch: fetchMock,
    ...overrides,
  })
  cleanups.push(() => context.start(() => otel.dispose()))
  return { otel, fetchMock }
}

const consentOf = (otel: ReturnType<typeof start>['otel']) =>
  (otel.options() as OptionsWithConsent).consent

test('F-10: submit writes category booleans onto each instance options', async () => {
  const host = start()
  const widget = start()
  const persistKey = `reatom.gdpr.test-${Math.random().toString(16).slice(2)}`

  await context.start(async () => {
    const consent = reatomGDPR({
      name: persistKey,
      persist: persistKey,
      instances: [host.otel, widget.otel],
      categories: { diagnostics: true, analytics: false, marketing: false },
    })

    expect(consent.fields.diagnostics()).toBe(true)
    expect(consent.fields.analytics()).toBe(false)
    expect(consent.fields.marketing()).toBe(false)
    expect(consentOf(host.otel)).toBeUndefined()
    expect(consent.snapshot()).toBe(null)

    consent.fields.analytics.change(true)
    expect(consent.snapshot()).toBe(null)
    expect(consentOf(host.otel)).toBeUndefined()
    await wrap(consent.submit())
    expect(consent.snapshot()).toEqual({
      submitted: true,
      categories: {
        diagnostics: true,
        analytics: true,
        marketing: false,
      },
    })

    const expected = {
      diagnostics: true,
      analytics: true,
      marketing: false,
    }
    expect(consentOf(host.otel)).toEqual(expected)
    expect(consentOf(widget.otel)).toEqual(expected)
    expect(host.fetchMock).not.toHaveBeenCalled()
    expect(widget.fetchMock).not.toHaveBeenCalled()

  })
})

test('spec otel option updates that instance on submit', async () => {
  const { otel, fetchMock } = start()
  const persistKey = `reatom.gdpr.otel-${Math.random().toString(16).slice(2)}`

  await context.start(async () => {
    const consent = reatomGDPR({
      name: persistKey,
      persist: persistKey,
      otel,
    })
    consent.fields.diagnostics.change(true)
    await wrap(consent.submit())
    expect(consentOf(otel)).toEqual({
      diagnostics: true,
      analytics: false,
      marketing: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

test('persisted submit restores fields and options for a new form', async () => {
  const first = start()
  const second = start()
  const persistKey = `reatom.gdpr.store-${Math.random().toString(16).slice(2)}`

  await context.start(async () => {
    const consent = reatomGDPR({
      name: persistKey,
      persist: persistKey,
      otel: first.otel,
      categories: { diagnostics: false, analytics: false, marketing: false },
    })
    consent.fields.marketing.change(true)
    await wrap(consent.submit())
    expect(consentOf(first.otel)).toMatchObject({ marketing: true })

    const restored = reatomGDPR({
      name: persistKey,
      persist: persistKey,
      otel: second.otel,
    })
    expect(restored.fields.marketing()).toBe(true)
    expect(restored.snapshot()?.categories.marketing).toBe(true)
    expect(consentOf(second.otel)).toMatchObject({
      diagnostics: false,
      analytics: false,
      marketing: true,
    })
  })
})

test('custom categories are included in the submitted consent', async () => {
  const { otel } = start()
  const persistKey = `reatom.gdpr.custom-${Math.random().toString(16).slice(2)}`

  await context.start(async () => {
    const consent = reatomGDPR({
      name: persistKey,
      persist: persistKey,
      otel,
      categories: {
        diagnostics: false,
        analytics: false,
        marketing: false,
        personalization: true,
      },
    })
    await wrap(consent.submit())
    expect(consentOf(otel)).toMatchObject({ personalization: true })
  })
})

test('F-10: submit analytics false withdraws the submitted snapshot', async () => {
  const { otel } = start()
  const persistKey = `reatom.gdpr.withdraw-${Math.random().toString(16).slice(2)}`

  await context.start(async () => {
    const consent = reatomGDPR({
      name: persistKey,
      persist: persistKey,
      otel,
    })
    consent.fields.analytics.change(true)
    await wrap(consent.submit())
    expect(consent.snapshot()?.categories.analytics).toBe(true)
    expect(consentOf(otel)).toMatchObject({ analytics: true })

    consent.fields.analytics.change(false)
    await wrap(consent.submit())
    expect(consent.snapshot()).toEqual({
      submitted: true,
      categories: {
        diagnostics: false,
        analytics: false,
        marketing: false,
      },
    })
    expect(consentOf(otel)).toMatchObject({ analytics: false })
  })
})

test('persist: false still updates options and does not restore later', async () => {
  const first = start()
  const second = start()
  const name = `gdpr-nopersist-${Math.random().toString(16).slice(2)}`

  await context.start(async () => {
    const consent = reatomGDPR({
      name,
      persist: false,
      otel: first.otel,
    })
    consent.fields.analytics.change(true)
    expect(consent.snapshot()).toBe(null)
    await wrap(consent.submit())
    expect(consent.snapshot()?.categories.analytics).toBe(true)
    expect(consentOf(first.otel)).toMatchObject({ analytics: true })

    const next = reatomGDPR({
      name,
      persist: false,
      otel: second.otel,
    })
    expect(next.fields.analytics()).toBe(false)
    expect(consentOf(second.otel)).toBeUndefined()
  })
})
