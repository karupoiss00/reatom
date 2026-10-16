import { wrap } from '@reatom/core'

import { recordHasError, recordLabel, recordTimeRange } from '../otlp/bind.ts'
import type { OtlpAdmin } from '../otlp/chrome.ts'
import { parseFilterCalculator } from '../otlp/calculator.ts'
import { hasActiveFilter, recordsForFilter } from '../otlp/filter.ts'
import {
  analyticsBreakdown,
  analyticsPathTree,
  analyticsTotals,
  analyticsTrend,
  selectAnalyticsSessions,
  typicalAnalyticsPath,
  typicalAnalyticsSession,
  type AnalyticsBreakdownRow,
  type AnalyticsDimension,
  type AnalyticsPathNode,
  type AnalyticsSession,
  type AnalyticsTotals,
  type AnalyticsTrend,
} from '../otlp/analytics.ts'
import { localValuesOf, stackCulprit, type AdminRecord } from '../otlp/ingest.ts'
import type { OtlpStateNode } from '../otlp/bind.ts'
import { ADMIN_MCP_MAX_BYTES } from './types.ts'
import {
  copyAttributes,
  decodeCursor,
  jsonUtf8Bytes,
  packCappedResponse,
  shrinkAttributes,
  truncateUnknown,
} from './cap.ts'
import { collectErrorGroups } from './errorGroups.ts'
import {
  countsHeadline,
  errorCountPhrase,
  missHeadline,
  nextCursorHint,
  searchHeadline,
  slowestPhrase,
  tracesHeadline,
  truncationHints,
} from './headline.ts'
import type {
  AdminMcpAnalyticsSummaryData,
  AdminMcpAnalyticsSummaryInput,
  AdminMcpAnalyticsTotals,
  AdminMcpBreakdownRow,
  AdminMcpCause,
  AdminMcpConnectRemoteInput,
  AdminMcpFilter,
  AdminMcpGetRecordInput,
  AdminMcpGetStateInput,
  AdminMcpGetTraceInput,
  AdminMcpHeader,
  AdminMcpListTracesInput,
  AdminMcpMiss,
  AdminMcpOk,
  AdminMcpPathNode,
  AdminMcpPathsData,
  AdminMcpPathsInput,
  AdminMcpRecordData,
  AdminMcpRecordSummary,
  AdminMcpSearchInput,
  AdminMcpStateData,
  AdminMcpStateNode,
  AdminMcpSummaryData,
  AdminMcpTraceData,
  AdminMcpTraceNode,
  AdminMcpTraceRow,
} from './types.ts'

function headerFromRecords(
  records: readonly AdminRecord[],
): Omit<AdminMcpHeader, 'truncated'> {
  const range = recordTimeRange(records)
  let errorCount = 0
  const traces = new Set<string>()
  for (const record of records) {
    traces.add(record.traceId)
    if (recordHasError(record)) errorCount += 1
  }
  return {
    recordCount: records.length,
    traceCount: traces.size,
    errorCount,
    start: range?.min ?? 0,
    end: range?.max ?? 0,
  }
}

function emptyHeader(): AdminMcpHeader {
  return {
    recordCount: 0,
    traceCount: 0,
    errorCount: 0,
    start: 0,
    end: 0,
    truncated: false,
  }
}

function miss(
  header: Omit<AdminMcpHeader, 'truncated'>,
  missing: AdminMcpMiss['missing'],
  extra: { id?: string; path?: string; error?: string } = {},
): AdminMcpMiss {
  const result = {
    ok: false as const,
    header: { ...header, truncated: false },
    missing,
    ...extra,
  }
  return {
    ...result,
    headline: missHeadline(result),
  }
}

function recordDurationMs(record: { start: number; end?: number }): number {
  return Math.max((record.end ?? record.start) - record.start, 0)
}

function errorThenSlowest<
  T extends { hasError: boolean; start: number; end?: number },
>(left: T, right: T): number {
  if (left.hasError !== right.hasError) return left.hasError ? -1 : 1
  const byDuration = recordDurationMs(right) - recordDurationMs(left)
  if (byDuration !== 0) return byDuration
  return left.start - right.start
}

function slowestOf<T extends { name: string; start: number; end?: number }>(
  items: readonly T[],
): string | undefined {
  let slowest: T | undefined
  for (const item of items) {
    if (!slowest || recordDurationMs(item) > recordDurationMs(slowest)) {
      slowest = item
    }
  }
  return slowest
    ? slowestPhrase(slowest.name, recordDurationMs(slowest))
    : undefined
}

function finishOk<T>(
  tool: string,
  result: AdminMcpOk<T>,
  nextCall?: string,
): AdminMcpOk<T> {
  const hints = truncationHints(tool, result, nextCall)
  return hints ? { ...result, hints } : result
}

function summarizeRecord(
  record: AdminRecord,
  highlightedIds?: ReadonlySet<string>,
): AdminMcpRecordSummary {
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    traceId: record.traceId,
    spanId: record.spanId,
    start: record.start,
    ...(record.end !== undefined ? { end: record.end } : {}),
    ...(record.reatomKind !== undefined
      ? { reatomKind: record.reatomKind }
      : {}),
    ...(record.atomName !== undefined ? { atomName: record.atomName } : {}),
    ...(record.eventName !== undefined ? { eventName: record.eventName } : {}),
    ...(record.outcome !== undefined ? { outcome: record.outcome } : {}),
    ...(record.frameId !== undefined ? { frameId: record.frameId } : {}),
    hasError: recordHasError(record),
    ...(highlightedIds?.has(record.id) ? { highlighted: true as const } : {}),
    attributes: copyAttributes(record.attributes),
  }
}

function shrinkRecordSummary(
  summary: AdminMcpRecordSummary,
): AdminMcpRecordSummary {
  return {
    ...summary,
    attributes: shrinkAttributes(
      summary.attributes,
      120,
      summary.hasError || summary.outcome === 'error',
    ),
  }
}

function inTraceParent(
  span: AdminRecord,
  spanIds: Set<string>,
): string | undefined {
  if (span.parentSpanId && spanIds.has(span.parentSpanId)) {
    return span.parentSpanId
  }
  return undefined
}

function hopsFromRoot(span: AdminRecord, spans: AdminRecord[]): number {
  const spanIds = new Set(spans.map((item) => item.spanId))
  let hops = 0
  let current: AdminRecord | undefined = span
  const seen = new Set<string>()
  while (current) {
    const parentId = inTraceParent(current, spanIds)
    if (!parentId || seen.has(parentId)) break
    seen.add(parentId)
    hops += 1
    current = spans.find((item) => item.spanId === parentId)
  }
  return hops
}

function summarizeTrace(
  records: AdminRecord[],
  highlightedIds?: ReadonlySet<string>,
): AdminMcpTraceRow {
  const spans = records.filter((record) => record.kind === 'span')
  const logs = records.filter((record) => record.kind === 'log')
  const spanIds = new Set(spans.map((span) => span.spanId))
  const root =
    spans.find((span) => !inTraceParent(span, spanIds)) ??
    spans[0] ??
    records[0]!
  const starts = records.map((record) => record.start)
  const ends = records.map((record) => record.end ?? record.start)
  const start = Math.min(...starts)
  const end = Math.max(...ends)
  const route = records.find((record) => record.reatomKind === 'route')
  const highlighted = records.some((record) => highlightedIds?.has(record.id))
  return {
    traceId: records[0]!.traceId,
    rootName: recordLabel(root),
    start,
    end,
    durationMs: Math.max(end - start, 0),
    spanCount: spans.length,
    logCount: logs.length,
    errorCount: records.filter(recordHasError).length,
    ...(route ? { route: recordLabel(route) } : {}),
    ...(highlighted ? { highlighted: true as const } : {}),
  }
}

function calculatorFilterMiss(
  admin: OtlpAdmin,
  filter: AdminMcpFilter | undefined,
) {
  const calculator = parseFilterCalculator(filter)
  if (calculator !== undefined && !calculator.ok) {
    return {
      miss: miss(headerFromRecords(admin.records()), 'filter', {
        error: calculator.error,
      }),
      calculator,
    }
  }
  return { miss: undefined, calculator }
}

function matchingTraceIds(records: readonly AdminRecord[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const record of records) {
    if (seen.has(record.traceId)) continue
    seen.add(record.traceId)
    ids.push(record.traceId)
  }
  return ids
}

function resolveCauseName(
  admin: OtlpAdmin,
  record: AdminRecord,
  causeId: string,
): string {
  const matches = admin.byFrame(causeId)
  const sameSource = matches.filter(
    (entry) => entry.sourceId === record.sourceId,
  )
  const pool = sameSource.length > 0 ? sameSource : matches
  const sameTrace = pool.filter((entry) => entry.traceId === record.traceId)
  const preferred = sameTrace.length > 0 ? sameTrace : pool
  const named = preferred.find((entry) => entry.kind === 'span') ?? preferred[0]
  return named ? recordLabel(named) : causeId
}

function resolveCauses(admin: OtlpAdmin, record: AdminRecord): AdminMcpCause[] {
  return record.causeIds.map((id) => ({
    id,
    name: resolveCauseName(admin, record, id),
  }))
}

function findStateNode(
  nodes: readonly OtlpStateNode[],
  path: string,
): OtlpStateNode | undefined {
  for (const node of nodes) {
    if (node.path === path || node.atomName === path) return node
    const nested = findStateNode(node.children, path)
    if (nested) return nested
  }
  return undefined
}

function toStateRow(node: OtlpStateNode): AdminMcpStateNode {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    path: node.path,
    childCount: node.children.length,
    ...(node.atomName !== undefined ? { atomName: node.atomName } : {}),
    ...(node.sourceId !== undefined ? { sourceId: node.sourceId } : {}),
    ...(node.recordId !== undefined ? { recordId: node.recordId } : {}),
    ...(node.frameId !== undefined ? { frameId: node.frameId } : {}),
    ...(node.value !== undefined ? { value: node.value } : {}),
  }
}

function flattenStateNodes(
  nodes: readonly OtlpStateNode[],
): AdminMcpStateNode[] {
  const rows: AdminMcpStateNode[] = []
  const walk = (list: readonly OtlpStateNode[]) => {
    for (const node of list) {
      rows.push(toStateRow(node))
      walk(node.children)
    }
  }
  walk(nodes)
  return rows
}

function maskLocalStateValue(
  node: AdminMcpStateNode,
  recordsById: Map<string, AdminRecord>,
): AdminMcpStateNode {
  if (node.recordId === undefined || node.value === undefined) return node
  const record = recordsById.get(node.recordId)
  if (!record || localValuesOf(record) === undefined) return node
  const masked =
    record.body !== undefined
      ? record.body
      : record.attributes['reatom.payload']
  if (masked === undefined) {
    const next = { ...node }
    delete next.value
    return next
  }
  return { ...node, value: masked }
}

function shrinkStateNode(node: AdminMcpStateNode): AdminMcpStateNode {
  return {
    ...node,
    value: truncateUnknown(node.value, 120),
    valueTruncated: true,
  }
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback
  }
  return Math.floor(value)
}

export function summaryTool(
  admin: OtlpAdmin,
): AdminMcpOk<AdminMcpSummaryData> | AdminMcpMiss {
  const records = admin.records()
  const header = headerFromRecords(records)
  const sourceCounts = new Map<string, number>()
  const nameCounts = new Map<string, number>()
  for (const record of records) {
    sourceCounts.set(
      record.sourceId,
      (sourceCounts.get(record.sourceId) ?? 0) + 1,
    )
    const name = recordLabel(record)
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  }
  const sources = [...sourceCounts.entries()].map(
    ([sourceId, recordCount]) => ({
      sourceId,
      recordCount,
    }),
  )
  const names = [...nameCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) =>
      right.count === left.count
        ? left.name.localeCompare(right.name)
        : right.count - left.count,
    )

  const errors = collectErrorGroups(records, (record, causeId) =>
    resolveCauseName(admin, record, causeId),
  )
  const packed = packCappedResponse({
    header,
    items: names,
    offset: 0,
    wrap: ({ items, header: packedHeader, nextCursor }) => {
      let keptErrors = errors
      const build = (errorGroups: typeof errors) =>
        finishOk(
          'summary',
          {
            ok: true as const,
            header: {
              ...packedHeader,
              truncated:
                packedHeader.truncated || errorGroups.length < errors.length,
            },
            headline: countsHeadline(header),
            data: {
              sources,
              names: items,
              errors: errorGroups,
              errorCount: header.errorCount,
              start: header.start,
              end: header.end,
            },
            ...(nextCursor !== undefined ? { nextCursor } : {}),
          },
          nextCursorHint('summary', nextCursor),
        )
      let body = build(keptErrors)
      while (
        keptErrors.length > 0 &&
        jsonUtf8Bytes(body) > ADMIN_MCP_MAX_BYTES
      ) {
        keptErrors = keptErrors.slice(0, -1)
        body = build(keptErrors)
      }
      return body
    },
  })
  return packed
}

export function listTracesTool(
  admin: OtlpAdmin,
  input: AdminMcpListTracesInput = {},
): AdminMcpOk<AdminMcpTraceRow[]> | AdminMcpMiss {
  const resolved = calculatorFilterMiss(admin, input.filter)
  if (resolved.miss) return resolved.miss
  const records = admin.records()
  const page = positiveInt(input.page, 1)
  const pageSize = positiveInt(input.pageSize, 20)
  const offset =
    input.cursor !== undefined
      ? decodeCursor(input.cursor)
      : (page - 1) * pageSize
  const resolvedFilter = recordsForFilter(
    admin,
    input.filter,
    resolved.calculator,
  )
  const matching = resolvedFilter.visible
  const rows = matchingTraceIds(matching)
    .map((traceId) =>
      summarizeTrace(admin.byTrace(traceId), resolvedFilter.highlightedIds),
    )
    .sort((left, right) =>
      left.start === right.start
        ? left.traceId.localeCompare(right.traceId)
        : left.start - right.start,
    )
  const remaining = rows.slice(offset)
  const header = {
    ...headerFromRecords(records),
    recordCount: matching.length,
    traceCount: rows.length,
    errorCount: rows.reduce((sum, row) => sum + row.errorCount, 0),
  }

  const slowest = remaining[0]
    ? [...remaining].sort((left, right) => right.durationMs - left.durationMs)[0]
    : undefined
  const packed = packCappedResponse({
    header,
    items: remaining,
    offset,
    limit: pageSize,
    wrap: ({ items, header: packedHeader, nextCursor }) =>
      finishOk(
        'listTraces',
        {
          ok: true as const,
          header: packedHeader,
          headline: tracesHeadline(
            header,
            [
              ...(slowest
                ? [slowestPhrase(slowest.rootName, slowest.durationMs) ?? '']
                : []),
            ].filter((part) => part !== ''),
          ),
          data: items,
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        },
        nextCursorHint('listTraces', nextCursor),
      ),
  })
  return packed
}

export function getTraceTool(
  admin: OtlpAdmin,
  input: AdminMcpGetTraceInput = {},
): AdminMcpOk<AdminMcpTraceData> | AdminMcpMiss {
  const storeRecords = admin.records()
  const storeHeader = headerFromRecords(storeRecords)
  const traceId = input.traceId
  if (!traceId) {
    return miss(storeHeader, 'trace', { id: traceId })
  }
  const records = admin.byTrace(traceId)
  if (records.length === 0) {
    return miss(storeHeader, 'trace', { id: traceId })
  }

  const spans = records.filter((record) => record.kind === 'span')
  const logs = records.filter((record) => record.kind === 'log')
  const spanIds = new Set(spans.map((span) => span.spanId))
  const depth =
    input.depth === undefined || !Number.isFinite(input.depth)
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor(input.depth))
  const offset = decodeCursor(input.cursor)

  const included = spans
    .filter((span) => hopsFromRoot(span, spans) <= depth)
    .sort((left, right) =>
      left.start === right.start
        ? left.spanId.localeCompare(right.spanId)
        : left.start - right.start,
    )

  const nodes: AdminMcpTraceNode[] = included.map((span) => {
    const parentSpanId = inTraceParent(span, spanIds)
    const childCount = spans.filter(
      (other) => inTraceParent(other, spanIds) === span.spanId,
    ).length
    return {
      id: span.id,
      spanId: span.spanId,
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      name: recordLabel(span),
      kind: span.kind,
      start: span.start,
      ...(span.end !== undefined ? { end: span.end } : {}),
      ...(span.outcome !== undefined ? { outcome: span.outcome } : {}),
      hasError: recordHasError(span),
      depth: hopsFromRoot(span, spans),
      childCount,
      attributes: copyAttributes(span.attributes),
      events: logs
        .filter((log) => log.spanId === span.spanId)
        .map((log) => summarizeRecord(log)),
    }
  })

  const remaining = nodes.sort(errorThenSlowest).slice(offset)
  const row = summarizeTrace(records)
  const packedHeaderBase = {
    ...storeHeader,
    recordCount: records.length,
    traceCount: 1,
    errorCount: row.errorCount,
    start: row.start,
    end: row.end,
  }

  const packed = packCappedResponse({
    header: packedHeaderBase,
    items: remaining,
    offset,
    shrinkItem: (node) => ({
      ...node,
      attributes: shrinkAttributes(node.attributes, 120, node.hasError),
      events: node.events.map(shrinkRecordSummary),
    }),
    missExtra: { id: traceId },
    wrap: ({ items, header, nextCursor }) =>
      finishOk(
        'getTrace',
        {
          ok: true as const,
          header,
          headline: [
            errorCountPhrase(row.errorCount),
            slowestPhrase(row.rootName, row.durationMs),
          ]
            .filter((part): part is string => part !== undefined)
            .join(' · '),
          data: {
            traceId,
            rootName: row.rootName,
            nodes: items,
          },
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        },
        nextCursorHint('getTrace', nextCursor, `traceId: "${traceId}"`),
      ),
  })
  return packed
}

export function searchTool(
  admin: OtlpAdmin,
  input: AdminMcpSearchInput = {},
): AdminMcpOk<AdminMcpRecordSummary[]> | AdminMcpMiss {
  const resolved = calculatorFilterMiss(admin, input.filter)
  if (resolved.miss) return resolved.miss
  const resolvedFilter = recordsForFilter(
    admin,
    input.filter,
    resolved.calculator,
  )
  const matches = resolvedFilter.visible
  const offset = decodeCursor(input.cursor)
  const remaining = matches
    .map((record) => summarizeRecord(record, resolvedFilter.highlightedIds))
    .sort(errorThenSlowest)
    .slice(offset)
  const header = {
    ...headerFromRecords(admin.records()),
    recordCount: matches.length,
    traceCount: new Set(matches.map((record) => record.traceId)).size,
    errorCount: matches.filter((record) => recordHasError(record)).length,
  }

  const packed = packCappedResponse({
    header,
    items: remaining,
    offset,
    shrinkItem: shrinkRecordSummary,
    missExtra: remaining[0] ? { id: remaining[0].id } : undefined,
    wrap: ({ items, header: packedHeader, nextCursor }) =>
      finishOk(
        'search',
        {
          ok: true as const,
          header: packedHeader,
          headline: searchHeadline(header, input.filter, slowestOf(items)),
          data: items,
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        },
        nextCursorHint('search', nextCursor),
      ),
  })
  return packed
}

function toRecordData(
  admin: OtlpAdmin,
  record: AdminRecord,
): AdminMcpRecordData {
  return {
    record: {
      id: record.id,
      sourceId: record.sourceId,
      kind: record.kind,
      traceId: record.traceId,
      spanId: record.spanId,
      ...(record.parentSpanId !== undefined
        ? { parentSpanId: record.parentSpanId }
        : {}),
      name: record.name,
      start: record.start,
      ...(record.end !== undefined ? { end: record.end } : {}),
      attributes: copyAttributes(record.attributes),
      ...(record.body !== undefined ? { body: record.body } : {}),
      resource: { ...record.resource },
      links: record.links.map((link) => ({ ...link })),
      ...(record.reatomKind !== undefined
        ? { reatomKind: record.reatomKind }
        : {}),
      ...(record.frameId !== undefined ? { frameId: record.frameId } : {}),
      causeIds: [...record.causeIds],
      ...(record.atomName !== undefined ? { atomName: record.atomName } : {}),
      ...(record.eventName !== undefined
        ? { eventName: record.eventName }
        : {}),
      ...(record.outcome !== undefined ? { outcome: record.outcome } : {}),
      ...(record.error !== undefined ? { error: { ...record.error } } : {}),
    },
    causes: resolveCauses(admin, record),
  }
}

function shrinkRecordData(data: AdminMcpRecordData): AdminMcpRecordData {
  const error = data.record.error
  const hasError =
    error !== undefined || data.record.outcome === 'error'
  return {
    causes: data.causes,
    record: {
      ...data.record,
      body: truncateUnknown(data.record.body, 400),
      attributes: shrinkAttributes(data.record.attributes, 120, hasError),
      ...(error
        ? {
            error: {
              ...error,
              ...(typeof error.message === 'string'
                ? {
                    message:
                      error.message.length > 400
                        ? `${error.message.slice(0, 400)}…`
                        : error.message,
                  }
                : {}),
              ...(typeof error.stack === 'string'
                ? {
                    stack:
                      stackCulprit(error.stack) ??
                      `${error.stack.slice(0, 200)}${error.stack.length > 200 ? '…' : ''}`,
                  }
                : {}),
            },
          }
        : {}),
    },
  }
}

export function getRecordTool(
  admin: OtlpAdmin,
  input: AdminMcpGetRecordInput = {},
): AdminMcpOk<AdminMcpRecordData> | AdminMcpMiss {
  const storeHeader = headerFromRecords(admin.records())
  const id = input.id
  if (!id) return miss(storeHeader, 'record', { id })
  const record = admin.records().find((entry) => entry.id === id)
  if (!record) return miss(storeHeader, 'record', { id })

  const data = toRecordData(admin, record)
  const packed = packCappedResponse({
    header: storeHeader,
    items: [data],
    offset: 0,
    shrinkItem: shrinkRecordData,
    missExtra: { id },
    wrap: ({ items, header }) =>
      finishOk('getRecord', {
        ok: true as const,
        header: { ...header, truncated: false },
        headline: [
          recordLabel(record),
          recordHasError(record) ? 'error' : undefined,
        ]
          .filter((part): part is string => part !== undefined)
          .join(' · '),
        data: items[0]!,
      }),
  })
  return packed
}

export function getStateTool(
  admin: OtlpAdmin,
  input: AdminMcpGetStateInput = {},
): AdminMcpOk<AdminMcpStateData> | AdminMcpMiss {
  const storeHeader = headerFromRecords(admin.records())
  const tree = admin.stateTree()
  const path = input.path ?? ''
  const roots =
    path === ''
      ? tree
      : (() => {
          const node = findStateNode(tree, path)
          return node ? [node] : undefined
        })()
  if (roots === undefined) {
    return miss(storeHeader, 'state', { path })
  }

  const recordsById = new Map(
    admin.records().map((record) => [record.id, record]),
  )
  const flat = flattenStateNodes(roots).map((node) =>
    maskLocalStateValue(node, recordsById),
  )
  const offset = decodeCursor(input.cursor)
  const remaining = flat.slice(offset)

  const packed = packCappedResponse({
    header: storeHeader,
    items: remaining,
    offset,
    shrinkItem: shrinkStateNode,
    missExtra: { path },
    wrap: ({ items, header, nextCursor }) =>
      finishOk(
        'getState',
        {
          ok: true as const,
          header,
          headline: `${items.length} state nodes${path === '' ? '' : ` · ${path}`}`,
          data: {
            path,
            nodes: items,
          },
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        },
        nextCursorHint('getState', nextCursor),
      ),
  })
  return packed
}

const ANALYTICS_DIMENSIONS: readonly AnalyticsDimension[] = [
  'page',
  'entry',
  'exit',
  'source',
]

const clampBreakdownLimit = (limit: number | undefined) => {
  const requested = limit ?? 10
  if (!Number.isFinite(requested)) return 10
  return Math.min(50, Math.max(1, Math.floor(requested)))
}

const clampPathLimit = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function analyticsCohort(
  admin: OtlpAdmin,
  filter: AdminMcpFilter | undefined,
  calculator: ReturnType<typeof parseFilterCalculator>,
  segment: AdminMcpAnalyticsSummaryInput['segment'],
  range: AdminMcpAnalyticsSummaryInput['range'],
): AnalyticsSession[] {
  const matchedRecords = hasActiveFilter(filter)
    ? recordsForFilter(admin, filter, calculator).matched
    : undefined
  return selectAnalyticsSessions(admin.analytics.sessions(), {
    matchedRecords,
    mode: segment,
    range,
  })
}

function mcpTotals(totals: AnalyticsTotals): AdminMcpAnalyticsTotals {
  return {
    visitors: totals.visitors,
    sessions: totals.sessions,
    pageViews: totals.pageViews,
    engagedSessions: totals.engagedSessions,
    engagementRate: totals.engagementRate,
    bounceRate: totals.bounceRate,
    sessionsWithErrors: totals.sessionsWithErrors,
    medianPageViews: totals.pageViewsPerSession.median,
    medianActiveMs: totals.activeMsPerSession.median,
    medianVisibleMs: totals.visibleMsPerSession.median,
  }
}

function mcpBreakdownRow(row: AnalyticsBreakdownRow): AdminMcpBreakdownRow {
  return {
    key: row.key,
    sessions: row.sessions,
    visitors: row.visitors,
    pageViews: row.pageViews,
    engagedSessions: row.engagedSessions,
    medianActiveMs: row.activeMs.median,
  }
}

function mcpPathNode(node: AnalyticsPathNode): AdminMcpPathNode {
  return {
    id: node.id,
    ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
    label: node.label,
    step: node.step,
    sessions: node.sessions,
    share: node.share,
    continuation: node.continuation,
    stops: node.stops,
    medianOffsetMs: node.offsetMs.median,
    medianDurationMs: node.durationMs.median,
    medianActiveMs: node.activeMs.median,
    sessionsWithErrors: node.sessionsWithErrors,
    folded: node.folded,
  }
}

export function analyticsSummaryTool(
  admin: OtlpAdmin,
  input: AdminMcpAnalyticsSummaryInput = {},
): AdminMcpOk<AdminMcpAnalyticsSummaryData> | AdminMcpMiss {
  const resolved = calculatorFilterMiss(admin, input.filter)
  if (resolved.miss) return resolved.miss
  const cohort = analyticsCohort(
    admin,
    input.filter,
    resolved.calculator,
    input.segment,
    input.range,
  )
  const totals = mcpTotals(analyticsTotals(cohort))
  const trend = analyticsTrend(cohort)
  const full = {} as Record<AnalyticsDimension, AnalyticsBreakdownRow[]>
  for (const dimension of ANALYTICS_DIMENSIONS) {
    full[dimension] = analyticsBreakdown(cohort, dimension)
  }
  const headerBase = headerFromRecords(admin.records())
  type TrendDetail = 'full' | 'thin' | 'none'
  const trendFor = (detail: TrendDetail): AnalyticsTrend => {
    if (detail === 'none') return { bucketMs: trend.bucketMs, buckets: [] }
    if (detail === 'thin') {
      return {
        bucketMs: trend.bucketMs * 2,
        buckets: trend.buckets.filter((_, index) => index % 2 === 0),
      }
    }
    return trend
  }
  const build = (rowLimit: number, detail: TrendDetail) => {
    const breakdowns = {} as Record<AnalyticsDimension, AdminMcpBreakdownRow[]>
    let truncated = detail !== 'full'
    for (const dimension of ANALYTICS_DIMENSIONS) {
      const rows = full[dimension]!
      if (rows.length > rowLimit) truncated = true
      breakdowns[dimension] = rows.slice(0, rowLimit).map(mcpBreakdownRow)
    }
    return finishOk('analyticsSummary', {
      ok: true as const,
      header: { ...headerBase, truncated },
      headline: `${cohort.length} sessions · ${totals.sessionsWithErrors} with errors`,
      data: {
        sessions: cohort.length,
        totalSessions: admin.analytics.sessions().length,
        totals,
        trend: trendFor(detail),
        breakdowns,
      },
    })
  }
  let cap = clampBreakdownLimit(input.limit)
  let detail: TrendDetail = 'full'
  let body = build(cap, detail)
  while (jsonUtf8Bytes(body) > ADMIN_MCP_MAX_BYTES) {
    if (cap > 1) cap = Math.floor(cap / 2)
    else if (detail === 'full') detail = 'thin'
    else if (detail === 'thin') detail = 'none'
    else return miss(headerBase, 'too-large')
    body = build(cap, detail)
  }
  return body
}

export function pathsTool(
  admin: OtlpAdmin,
  input: AdminMcpPathsInput = {},
): AdminMcpOk<AdminMcpPathsData> | AdminMcpMiss {
  const resolved = calculatorFilterMiss(admin, input.filter)
  if (resolved.miss) return resolved.miss
  const cohort = analyticsCohort(
    admin,
    input.filter,
    resolved.calculator,
    input.segment,
    input.range,
  )
  const nodes = analyticsPathTree(cohort, {
    align: input.align,
    maxDepth: clampPathLimit(input.maxDepth, 8, 1, 20),
    maxChildren: clampPathLimit(input.maxChildren, 6, 1, 50),
  })
  const typicalPath = typicalAnalyticsPath(nodes)
  const typicalSession = typicalAnalyticsSession(cohort, typicalPath)
  const shown = nodes[0]?.sessions ?? 0
  const offset = decodeCursor(input.cursor)
  const header = headerFromRecords(admin.records())
  const packed = packCappedResponse({
    header,
    items: nodes.slice(offset),
    offset,
    wrap: ({ items, header: packedHeader, nextCursor }) =>
      finishOk(
        'paths',
        {
          ok: true as const,
          header: packedHeader,
          headline: `${shown} path sessions · ${cohort.length - shown} left out`,
          data: {
            sessions: shown,
            leftOut: cohort.length - shown,
            ...(input.align !== undefined ? { align: input.align } : {}),
            typicalPathIds: typicalPath.map((node) => node.id),
            ...(typicalSession !== undefined
              ? { typicalSessionId: typicalSession.id }
              : {}),
            nodes: items.map(mcpPathNode),
          },
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        },
        nextCursorHint('paths', nextCursor),
      ),
  })
  return packed
}

export function clearTool(admin: OtlpAdmin): AdminMcpOk<{ cleared: true }> {
  admin.clear()
  return {
    ok: true,
    header: emptyHeader(),
    headline: 'cleared · write with no undo',
    data: { cleared: true },
  }
}

export async function connectRemoteTool(
  admin: OtlpAdmin,
  input: AdminMcpConnectRemoteInput = {},
): Promise<AdminMcpOk<{ recordCount: number }> | AdminMcpMiss> {
  const fields = admin.remoteForm.fields
  if (input.url !== undefined) fields.url.change(input.url)
  if (input.database !== undefined) fields.database.change(input.database)
  if (input.user !== undefined) fields.user.change(input.user)
  if (input.password !== undefined) fields.password.change(input.password)
  try {
    const payload = await wrap(admin.connectRemote())
    const records = admin.records()
    const recordCount =
      payload !== undefined &&
      typeof payload === 'object' &&
      payload !== null &&
      'recordCount' in payload &&
      typeof payload.recordCount === 'number'
        ? payload.recordCount
        : records.length
    return {
      ok: true,
      header: { ...headerFromRecords(records), truncated: false },
      headline: `${recordCount} records from ClickHouse`,
      data: { recordCount },
    }
  } catch {
    const message =
      admin.connectRemote.error()?.message ?? 'ClickHouse connect failed'
    return miss(emptyHeader(), 'remote', { id: message })
  }
}
