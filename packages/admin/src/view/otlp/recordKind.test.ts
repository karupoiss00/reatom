import { expect, test } from 'test'

import type { AdminRecord } from '../../otlp'
import { kindTokens } from '../design-system/tokens'
import {
  kindColorVar,
  kindWord,
  recordKindIcon,
  recordRowDescription,
  recordStatusIcon,
  statusWord,
} from './recordKind'

function record(patch: Partial<AdminRecord> = {}): AdminRecord {
  return {
    id: 'row',
    sourceId: 'local',
    kind: 'span',
    traceId: 'trace',
    spanId: 'span',
    name: 'makeMove',
    start: 0,
    end: 0,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
    ...patch,
  }
}

test('recordKindIcon maps spans, reatom kinds, mount logs, and framework spans', () => {
  expect(recordKindIcon(record())).toBe('action')
  expect(recordKindIcon(record({ kind: 'log', reatomKind: 'action' }))).toBe(
    'action',
  )
  expect(recordKindIcon(record({ kind: 'log' }))).toBe('log')
  expect(
    recordKindIcon(
      record({
        kind: 'log',
        reatomKind: 'atom',
        eventName: 'reatom.atom.update',
      }),
    ),
  ).toBe('atom')
  expect(recordKindIcon(record({ reatomKind: 'computed' }))).toBe('computed')
  expect(recordKindIcon(record({ kind: 'log', reatomKind: 'effect' }))).toBe(
    'effect',
  )
  expect(recordKindIcon(record({ reatomKind: 'route' }))).toBe('route')
  expect(recordKindIcon(record({ reatomKind: 'loader' }))).toBe('framework')
  expect(recordKindIcon(record({ reatomKind: 'render' }))).toBe('framework')
  expect(recordKindIcon(record({ reatomKind: 'session' }))).toBe('framework')
  expect(recordKindIcon(record({ reatomKind: 'page_view' }))).toBe('framework')
  expect(recordKindIcon(record({ reatomKind: 'mount' }))).toBe('mount')
  const connectWrite = record({
    id: 'connect',
    kind: 'log',
    reatomKind: 'atom',
    eventName: 'reatom.atom.update',
    causeIds: ['hook'],
  })
  expect(recordKindIcon(connectWrite)).toBe('atom')
  expect(recordKindIcon(connectWrite, new Set(['connect']))).toBe('mount')
})

test('recordStatusIcon prefers an error over abort, suspense, and pending', () => {
  expect(recordStatusIcon(record())).toBeNull()
  expect(recordStatusIcon(record({ outcome: 'abort' }))).toBe('abort')
  expect(recordStatusIcon(record({ outcome: 'suspense' }))).toBe('suspense')
  expect(recordStatusIcon(record({ outcome: 'pending' }))).toBe('pending')
  expect(recordStatusIcon(record({ outcome: 'error' }))).toBe('error')
  expect(
    recordStatusIcon(
      record({ outcome: 'abort', error: { message: 'stopped' } }),
    ),
  ).toBe('error')
})

test('kind words and color variables use the admin kind tokens', () => {
  expect(kindWord('log')).toBe('LOG')
  expect(kindWord('framework')).toBe('framework span')
  expect(kindWord('action')).toBe('action')
  expect(statusWord('pending')).toBe('in progress')
  expect(kindColorVar('action')).toBe(kindTokens.action)
  expect(kindColorVar('atom')).toBe(kindTokens.atom)
  expect(kindColorVar('log')).toBe(kindTokens.log)
  expect(kindColorVar('mount')).toBe(kindTokens.other)
  expect(kindColorVar('route')).toBe(kindTokens.other)
  expect(kindColorVar('framework')).toBe(kindTokens.other)
})

test('recordRowDescription lists kind, status, spans, and duration without the name', () => {
  expect(
    recordRowDescription(record({ reatomKind: 'action' }), {
      spanCount: 2,
      duration: '0ms',
    }),
  ).toBe('action, 2 spans, 0ms')
  expect(
    recordRowDescription(
      record({ kind: 'log', reatomKind: 'atom', name: 'board' }),
    ),
  ).toBe('atom')
  expect(
    recordRowDescription(
      record({ name: 'chat.sendMessage', outcome: 'pending' }),
      { spanCount: 1, duration: '1.2s' },
    ),
  ).toBe('action, in progress, 1 span, 1.2s')
})
