import { action, context, wrap } from '@reatom/core'
import { afterEach, expect, test } from 'vitest'

import { reatomOpentelemetry } from '../reatomOpentelemetry.ts'
import { reatomGDPR, withGDPR } from './index.ts'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) context.start(cleanups.pop()!)
})
const start = () => {
  const otel = reatomOpentelemetry({
    name: `gdpr-${Math.random()}`,
    endpoint: null,
    serviceName: 'gdpr',
    skipGlobalExtension: true,
  })
  cleanups.push(() => otel.dispose())
  return otel
}

test('default extension exposes a real form, denies offered categories, and ignores drafts', async () => {
  await context.start(async () => {
    const otel = start().extend(withGDPR({ persist: false }))
    expect(typeof otel.gdpr.submit).toBe('function')
    expect(otel.gdpr.snapshot()).toBe(null)
    expect(otel().consent).toEqual({
      diagnostics: false,
      analytics: false,
      marketing: false,
    })
    otel.gdpr.fields.diagnostics.change(true)
    otel.gdpr.fields.analytics.change(true)
    expect(otel().consent?.diagnostics).toBe(false)
    await wrap(otel.gdpr.submit())
    expect(otel().consent).toEqual({
      diagnostics: true,
      analytics: true,
      marketing: false,
    })
    otel.gdpr.fields.analytics.change(false)
    expect(otel().consent?.analytics).toBe(true)
    await wrap(otel.gdpr.submit())
    expect(otel().consent?.analytics).toBe(false)
  })
})

test('standalone form persists submitted choices and extension restores before capture', async () => {
  await context.start(async () => {
    const key = `gdpr-restore-${Math.random()}`
    const first = reatomGDPR({ persist: key })
    first.fields.analytics.change(true)
    await wrap(first.submit())
    const otel = start().extend(withGDPR({ persist: key }))
    expect(otel.gdpr.fields.analytics()).toBe(true)
    expect(otel.gdpr.snapshot()?.submitted).toBe(true)
    expect(otel().consent?.analytics).toBe(true)
  })
})

test('shared submitted form binds independently and remains usable after one parent is disposed', async () => {
  await context.start(async () => {
    const gdpr = reatomGDPR({ persist: false })
    const first = start().extend(withGDPR(gdpr))
    const second = start().extend(withGDPR(gdpr))
    expect(first.gdpr).toBe(gdpr)
    first.dispose()
    gdpr.fields.diagnostics.change(true)
    await wrap(gdpr.submit())
    expect(second().consent?.diagnostics).toBe(true)
    expect(gdpr.snapshot()?.categories.diagnostics).toBe(true)
  })
})

test('custom offered categories default denied without inventing diagnostics', async () => {
  await context.start(async () => {
    const otel = start().extend(
      withGDPR({
        persist: false,
        categories: { analytics: true, personalization: true },
      }),
    )
    expect(otel().consent).toEqual({ analytics: false, personalization: false })
    await wrap(otel.gdpr.submit())
    expect(otel().consent).toEqual({ analytics: true, personalization: true })
  })
})

test('GDPR preflight rejects duplicate, disposed, and late policy installation', () => {
  context.start(() => {
    const duplicate = start().extend(withGDPR({ persist: false }))
    let reads = 0
    const options = {
      get categories() {
        reads++
        return { diagnostics: false, analytics: false, marketing: false }
      },
    }
    expect(() => duplicate.extend(withGDPR(options))).toThrow()
    expect(reads).toBe(0)
    const disposed = start()
    disposed.dispose()
    expect(() => disposed.extend(withGDPR(options))).toThrow()
    expect(reads).toBe(0)
    const late = start()
    late.log('already captured')
    expect(() => late.extend(withGDPR())).toThrow()
  })
})

test('unsubmitted default form prevents diagnostic values and respects signal kill switches', async () => {
  await context.start(async () => {
    const otel = start().extend(withGDPR({ persist: false }))
    const emit = action((secret: string) => secret, 'gdpr.private').extend(
      otel.withOTel(),
    )
    emit('identity')
    expect(JSON.stringify(otel.records())).not.toContain('identity')
    otel.set((state) => ({
      ...state,
      signals: { ...state.signals, logs: false, traces: false },
    }))
    otel.gdpr.fields.diagnostics.change(true)
    await wrap(otel.gdpr.submit())
    expect(otel().signals?.logs).toBe(false)
    expect(otel().signals?.traces).toBe(false)
  })
})

test('withGDPR() is defaulted reatomGDPR and absent until applied', () => {
  context.start(() => {
    const plain = start()
    expect('gdpr' in plain).toBe(false)
    const otel = plain.extend(withGDPR())
    expect(otel.gdpr.fields.diagnostics()).toBe(false)
    expect(otel.gdpr.fields.analytics()).toBe(false)
    expect(otel.gdpr.fields.marketing()).toBe(false)
  })
})
