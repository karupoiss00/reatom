import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'test'

import { ADMIN_FRAME } from '../root'
import { reatomOtlpMcp } from '../mcp/index.ts'
import { reatomOtlpAdmin } from './chrome.ts'
import { LOCAL_VALUES, type AdminRecord } from './ingest.ts'
import { matchesQuery } from './filter.ts'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'))

const INSTANCE_RESOURCE = {
  'service.name': 'reatom-admin-test',
  'service.instance.id': 'local',
}

const atomUpdate = readFixture('atom-update.json') as {
  span: unknown
  log: unknown
}

const exceptionJoin = readFixture('exception-join.json') as {
  span: unknown
  log: unknown
}

const routeSpan = {
  traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  spanId: 'bbbbbbbbbbbbbbbb',
  name: 'route goods',
  startTimeUnixNano: '1791352144731000000',
  endTimeUnixNano: '1791352144731000000',
  attributes: {
    'reatom.kind': 'route',
    'reatom.name': 'goods',
  },
}

function ingestAll() {
  const admin = reatomOtlpAdmin({
    sourceId: 'local',
    resource: INSTANCE_RESOURCE,
  })
  ADMIN_FRAME.run(() =>
    admin.ingest([
      exceptionJoin.span,
      exceptionJoin.log,
      atomUpdate.span,
      atomUpdate.log,
      routeSpan,
    ]),
  )
  return { admin, mcp: reatomOtlpMcp(admin) }
}

test('chrome Errors / Routes / name glob match MCP search', () => {
  const { admin, mcp } = ingestAll()

  ADMIN_FRAME.run(() => {
    expect(admin.feedRecords()).toHaveLength(5)
    expect(admin.summary().visibleFrames).toBe(5)

    admin.filterHasError.set(true)
    expect(admin.filter()).toEqual({ hasError: true })
    const errors = admin.feedRecords()
    expect(errors.some((record) => record.name === 'explode')).toBe(true)
    expect(errors.every((record) => record.error != null || record.outcome === 'error')).toBe(
      true,
    )
    const mcpErrors = mcp.search({ filter: admin.filter() })
    expect(mcpErrors.ok).toBe(true)
    if (!mcpErrors.ok) return
    expect(mcpErrors.data.map((row) => row.id).sort()).toEqual(
      errors.map((record) => record.id).sort(),
    )

    admin.resetFilter()
    admin.filterReatomKind.set('route')
    expect(admin.feedRecords().map((record) => record.name)).toEqual(['route goods'])
    const mcpRoutes = mcp.search({ filter: admin.filter() })
    expect(mcpRoutes.ok).toBe(true)
    if (!mcpRoutes.ok) return
    expect(mcpRoutes.data).toHaveLength(1)
    expect(mcpRoutes.data[0]!.name).toBe('route goods')

    admin.resetFilter()
    admin.filterName.set('route*')
    expect(admin.filter()).toEqual({ name: 'route*' })
    expect(admin.feedRecords().map((record) => record.name)).toEqual(['route goods'])
    expect(admin.summary().visibleFrames).toBe(1)
    expect(admin.summary().totalFrames).toBe(5)

    admin.filterName.set('tree.checked')
    expect(admin.feedRecords().some((record) => record.atomName === 'tree.checked')).toBe(
      true,
    )
    admin.filterName.set('TREE')
    expect(
      admin.feedRecords().every(
        (record) =>
          record.name.toLowerCase().includes('tree') ||
          record.atomName?.toLowerCase().includes('tree') === true,
      ),
    ).toBe(true)
    expect(admin.feedRecords().some((record) => record.name === 'explode')).toBe(
      false,
    )

    admin.resetFilter()
    expect(admin.filter()).toEqual({})
    expect(admin.feedRecords()).toHaveLength(5)
  })
})

test('calculator FilterGroup reduces Activity and matches MCP search', () => {
  const { admin, mcp } = ingestAll()

  ADMIN_FRAME.run(() => {
    admin.filterCalculator.set('name:explode AND kind:action')
    expect(admin.filter()).toEqual({
      calculator: 'name:explode AND kind:action',
    })
    expect(admin.feedRecords().map((entry) => entry.name)).toEqual(['explode'])
    expect(admin.summary().visibleFrames).toBe(1)
    expect(admin.summary().totalFrames).toBe(5)

    const searched = mcp.search({ filter: admin.filter() })
    expect(searched.ok).toBe(true)
    if (!searched.ok) return
    expect(searched.data.map((row) => row.name)).toEqual(['explode'])

    admin.filterCalculator.set('name:missing')
    expect(admin.feedRecords()).toEqual([])

    admin.filterCalculator.set('name=EXPLODE AND kind=ACTION')
    expect(admin.filter()).toEqual({
      calculator: 'name=EXPLODE AND kind=ACTION',
    })
    expect(admin.feedRecords().map((entry) => entry.name)).toEqual(['explode'])
    const equalsSearch = mcp.search({ filter: admin.filter() })
    expect(equalsSearch.ok).toBe(true)
    if (!equalsSearch.ok) return
    expect(equalsSearch.data.map((row) => row.name)).toEqual(['explode'])

    const invalid = mcp.search({ filter: { calculator: 'bogus:1' } })
    expect(invalid.ok).toBe(false)
    if (invalid.ok) return
    expect(invalid.missing).toBe('filter')
    expect(invalid.error).toMatch(/Unknown target/)
    const listed = mcp.listTraces({ filter: { calculator: 'foo:bar' } })
    expect(listed.ok).toBe(false)
    if (listed.ok) return
    expect(listed.missing).toBe('filter')
    expect(listed.error).toMatch(/Unknown target/)
    expect(admin.feedRecords().map((entry) => entry.name)).toEqual(['explode'])

    admin.filterCalculator.set('bogus:1')
    expect(admin.filter()).toEqual({})
    expect(admin.feedRecords()).toHaveLength(5)

    admin.resetFilter()
    expect(admin.filter()).toEqual({})
    expect(admin.filterCalculator()).toBe('')
    expect(admin.feedRecords()).toHaveLength(5)
  })
})

const explodeRetrySpan = {
  traceId: '5b8efff798038103d269b633813fc60c',
  spanId: 'cccccccccccccccc',
  parentSpanId: 'eee19b7ec3c1b174',
  name: 'retry',
  kind: 1,
  startTimeUnixNano: '1761000000125000000',
  endTimeUnixNano: '1761000000126000000',
  attributes: {
    'reatom.name': 'retry',
    'reatom.kind': 'action',
    'reatom.outcome': 'ok',
    'reatom.params': '[]',
    'reatom.frame.id': '2',
    'reatom.cause.ids': ['1'],
  },
}

test('calculator spans>1 reduces Activity to the busy trace and matches MCP', () => {
  const { admin, mcp } = ingestAll()

  ADMIN_FRAME.run(() => {
    admin.ingest([explodeRetrySpan])
    expect(admin.summary().totalFrames).toBe(6)

    admin.filterCalculator.set('spans>1')
    expect(admin.filter()).toEqual({ calculator: 'spans>1' })
    expect(admin.feedRecords().map((entry) => entry.name)).toEqual([
      'explode',
      'exception',
      'retry',
    ])
    expect(admin.summary().visibleFrames).toBe(3)

    const searched = mcp.search({ filter: admin.filter() })
    expect(searched.ok).toBe(true)
    if (!searched.ok) return
    expect(searched.data.map((row) => row.name)).toEqual([
      'explode',
      'exception',
      'retry',
    ])

    const listed = mcp.listTraces({ filter: admin.filter() })
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.data).toHaveLength(1)

    admin.filterCalculator.set('spans=1')
    expect(
      admin.feedRecords().map((entry) => entry.atomName ?? entry.name),
    ).toEqual(['tree#12.toggle', 'tree.checked', 'route goods'])
    expect(admin.summary().visibleFrames).toBe(3)
  })
})

test('calculator cause> reduces Activity to the caused record and matches MCP', () => {
  const { admin, mcp } = ingestAll()

  ADMIN_FRAME.run(() => {
    admin.filterCalculator.set('cause>tree#12.toggle')
    expect(admin.filter()).toEqual({ calculator: 'cause>tree#12.toggle' })
    expect(
      admin.feedRecords().map((entry) => entry.atomName ?? entry.name),
    ).toEqual(['tree.checked'])
    expect(admin.summary().visibleFrames).toBe(1)
    expect(admin.summary().totalFrames).toBe(5)

    const searched = mcp.search({ filter: admin.filter() })
    expect(searched.ok).toBe(true)
    if (!searched.ok) return
    expect(searched.data.map((row) => row.atomName ?? row.name)).toEqual([
      'tree.checked',
    ])

    admin.filterCalculator.set('cause<tree.checked')
    expect(
      admin.feedRecords().map((entry) => entry.atomName ?? entry.name),
    ).toEqual(['tree#12.toggle'])
    const parents = mcp.search({ filter: admin.filter() })
    expect(parents.ok).toBe(true)
    if (!parents.ok) return
    expect(parents.data.map((row) => row.atomName ?? row.name)).toEqual([
      'tree#12.toggle',
    ])
  })
})

test('calculator hide highlight exclude modes change Activity and MCP search', () => {
  const { admin, mcp } = ingestAll()

  ADMIN_FRAME.run(() => {
    admin.filterCalculator.set('name:explode')
    expect(admin.filter()).toEqual({ calculator: 'name:explode' })
    expect(admin.feedRecords().map((entry) => entry.name)).toEqual(['explode'])
    expect(admin.summary().visibleFrames).toBe(1)
    expect(admin.summary().highlightedFrames).toBe(0)

    admin.filterMode.set('hide')
    expect(admin.filter()).toEqual({
      calculator: 'name:explode',
      mode: 'hide',
    })
    const hiddenNames = admin.feedRecords().map((entry) => entry.name)
    expect(hiddenNames).not.toContain('explode')
    expect(hiddenNames).toHaveLength(4)
    expect(admin.summary().visibleFrames).toBe(4)
    expect(admin.summary().totalFrames).toBe(5)
    const hiddenSearch = mcp.search({ filter: admin.filter() })
    expect(hiddenSearch.ok).toBe(true)
    if (!hiddenSearch.ok) return
    expect(hiddenSearch.data.map((row) => row.name)).not.toContain('explode')
    expect(hiddenSearch.data).toHaveLength(4)

    admin.filterMode.set('exclude')
    expect(admin.filter().mode).toBe('exclude')
    expect(admin.feedRecords().map((entry) => entry.name)).not.toContain(
      'explode',
    )
    expect(admin.summary().visibleFrames).toBe(4)
    const excludedSearch = mcp.search({ filter: admin.filter() })
    expect(excludedSearch.ok).toBe(true)
    if (!excludedSearch.ok) return
    expect(excludedSearch.data.map((row) => row.name)).not.toContain('explode')

    admin.filterMode.set('highlight')
    expect(admin.filter()).toEqual({
      calculator: 'name:explode',
      mode: 'highlight',
    })
    expect(admin.feedRecords()).toHaveLength(5)
    expect(admin.summary().visibleFrames).toBe(5)
    expect(admin.summary().highlightedFrames).toBe(1)
    const highlighted = admin.feedRecords().filter((entry) =>
      admin.highlightedIds().has(entry.id),
    )
    expect(highlighted.map((entry) => entry.name)).toEqual(['explode'])
    const highlightSearch = mcp.search({ filter: admin.filter() })
    expect(highlightSearch.ok).toBe(true)
    if (!highlightSearch.ok) return
    expect(highlightSearch.data).toHaveLength(5)
    const flagged = highlightSearch.data.filter((row) => row.highlighted)
    expect(flagged).toHaveLength(1)
    expect(flagged[0]!.name).toBe('explode')
    expect(flagged[0]!.highlighted).toBe(true)
    expect(
      highlightSearch.data.filter((row) => row.name !== 'explode').every(
        (row) => row.highlighted === undefined,
      ),
    ).toBe(true)

    admin.filterMode.set('show')
    expect(admin.filter()).toEqual({ calculator: 'name:explode' })
    expect(admin.feedRecords().map((entry) => entry.name)).toEqual(['explode'])

    admin.resetFilter()
    admin.filterMode.set('hide')
    expect(admin.filter()).toEqual({ mode: 'hide' })
    expect(admin.feedRecords()).toHaveLength(5)
  })
})

test('traceId scopes Hide and does not empty the scoped trace', () => {
  const { admin, mcp } = ingestAll()

  ADMIN_FRAME.run(() => {
    const explode = admin.feedRecords().find((entry) => entry.name === 'explode')
    expect(explode).toBeDefined()
    const explodeTrace = explode!.traceId
    expect(admin.feedRecords().some((entry) => entry.traceId !== explodeTrace)).toBe(
      true,
    )

    const scopedHide = mcp.search({
      filter: { traceId: explodeTrace, mode: 'hide' },
    })
    expect(scopedHide.ok).toBe(true)
    if (!scopedHide.ok) return
    expect(scopedHide.data.length).toBeGreaterThan(0)
    expect(scopedHide.data.every((row) => row.traceId === explodeTrace)).toBe(
      true,
    )
    expect(scopedHide.data.some((row) => row.name === 'explode')).toBe(true)

    const hideExplodeInTrace = mcp.search({
      filter: {
        traceId: explodeTrace,
        calculator: 'name:explode',
        mode: 'hide',
      },
    })
    expect(hideExplodeInTrace.ok).toBe(true)
    if (!hideExplodeInTrace.ok) return
    expect(hideExplodeInTrace.data.every((row) => row.traceId === explodeTrace)).toBe(
      true,
    )
    expect(hideExplodeInTrace.data.map((row) => row.name)).not.toContain(
      'explode',
    )
    expect(hideExplodeInTrace.data.length).toBeGreaterThan(0)
  })
})

test('clear drops the session filter', () => {
  const { admin } = ingestAll()
  ADMIN_FRAME.run(() => {
    admin.filterHasError.set(true)
    admin.filterName.set('explode')
    expect(admin.feedRecords().length).toBeGreaterThan(0)
    admin.clear()
    expect(admin.filter()).toEqual({})
    expect(admin.filterName()).toBe('')
    expect(admin.filterHasError()).toBeUndefined()
    expect(admin.feedRecords()).toEqual([])
  })
})

test('free text matches masked attributes and local value text', () => {
  const entry: AdminRecord = {
    id: 'id',
    sourceId: 'local',
    kind: 'log',
    traceId: 'aa',
    spanId: 'bb',
    name: 'score',
    start: 0,
    attributes: { 'reatom.payload': '"***"' },
    body: '***',
    resource: {},
    links: [],
    causeIds: [],
    [LOCAL_VALUES]: { state: { token: 'live-secret-token' } },
  }
  expect(matchesQuery(entry, 'live-secret-token')).toBe(true)
  expect(matchesQuery(entry, '***')).toBe(true)
  expect(matchesQuery(entry, 'missing-token')).toBe(false)
})
