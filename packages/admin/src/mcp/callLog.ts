import { atom, type Atom } from '@reatom/core'

import { quoteCalculatorValue } from '../otlp/calculator.ts'
import type { OtlpAdmin } from '../otlp/chrome.ts'
import { ADMIN_FRAME, onAdminReset } from '../root'
import type { AdminMcpFilter, AdminMcpMiss, AdminMcpOk } from './types.ts'

export const ADMIN_MCP_CALL_LOG_LIMIT = 50

export const ADMIN_MCP_WRITE_TOOLS = new Set(['clear', 'connectRemote'])

export interface AdminMcpCallEntry {
  tool: string
  args: unknown
  ms: number
  headline: string
  ok: boolean
  recordIds: string[]
  filter?: AdminMcpFilter
}

export interface AdminMcpCallLog {
  revision: Atom<number>
  agentReadIds: Atom<Set<string>>
  lastReadCount: Atom<number>
  entries: () => AdminMcpCallEntry[]
  writeCount: () => number
  totalMs: () => number
  push: (entry: AdminMcpCallEntry) => void
  applyThisFilter: (admin: OtlpAdmin, entry: AdminMcpCallEntry) => void
  showOnTimeline: (admin: OtlpAdmin, entry: AdminMcpCallEntry) => void
}

let storedEntries: AdminMcpCallEntry[] = []
let callLogModel: AdminMcpCallLog | null = null

export function mcpFilterToCalculatorDraft(filter: AdminMcpFilter): string {
  if (filter.calculator !== undefined && filter.calculator.trim() !== '') {
    return filter.calculator.trim()
  }
  const clauses: string[] = []
  if (filter.name) clauses.push(`name:${quoteCalculatorValue(filter.name)}`)
  if (filter.kind) clauses.push(`kind:${filter.kind}`)
  if (filter.reatomKind) clauses.push(`kind:${filter.reatomKind}`)
  if (filter.hasError === true) clauses.push('errors:true')
  if (filter.query) clauses.push(`params:${quoteCalculatorValue(filter.query)}`)
  return clauses.join(' ')
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username === '' && parsed.password === '') return url
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return url
  }
}

export function redactMcpArgs(tool: string, args: unknown): unknown {
  if (tool !== 'connectRemote' || args === null || typeof args !== 'object') {
    return args
  }
  const next = { ...(args as Record<string, unknown>) }
  if ('password' in next) next.password = '***'
  if (typeof next.url === 'string') next.url = redactUrl(next.url)
  return next
}

export function recordIdsFromResult(
  tool: string,
  result: AdminMcpOk<unknown> | AdminMcpMiss,
): string[] {
  if (!result.ok) return []
  const data = result.data
  if (tool === 'search' && Array.isArray(data)) {
    return data
      .map((row) =>
        row && typeof row === 'object' && 'id' in row && typeof row.id === 'string'
          ? row.id
          : undefined,
      )
      .filter((id): id is string => id !== undefined)
  }
  if (
    tool === 'getRecord' &&
    data &&
    typeof data === 'object' &&
    'record' in data &&
    data.record &&
    typeof data.record === 'object' &&
    'id' in data.record &&
    typeof data.record.id === 'string'
  ) {
    return [data.record.id]
  }
  if (
    tool === 'getTrace' &&
    data &&
    typeof data === 'object' &&
    'nodes' in data &&
    Array.isArray(data.nodes)
  ) {
    return data.nodes
      .map((node) =>
        node && typeof node === 'object' && 'id' in node && typeof node.id === 'string'
          ? node.id
          : undefined,
      )
      .filter((id): id is string => id !== undefined)
  }
  return []
}

function createMcpCallLog(): AdminMcpCallLog {
  const revision = atom(0, '_Admin.mcp.callLogRevision')
  const lastReadCount = atom(0, '_Admin.mcp.lastReadCount')
  const agentReadIds = atom(new Set<string>(), '_Admin.mcp.agentReadIds')
  const refreshAgentReadIds = () => {
    const ids = new Set<string>()
    for (const entry of storedEntries) {
      for (const id of entry.recordIds) ids.add(id)
    }
    agentReadIds.set(ids)
  }
  const entries = () => storedEntries
  const writeCount = () =>
    storedEntries.filter((entry) => ADMIN_MCP_WRITE_TOOLS.has(entry.tool)).length
  const totalMs = () =>
    storedEntries.reduce((sum, entry) => sum + entry.ms, 0)
  const push = (entry: AdminMcpCallEntry) => {
    const next = [...storedEntries, entry]
    storedEntries =
      next.length > ADMIN_MCP_CALL_LOG_LIMIT
        ? next.slice(next.length - ADMIN_MCP_CALL_LOG_LIMIT)
        : next
    ADMIN_FRAME.run(() => {
      if (entry.recordIds.length > 0) {
        lastReadCount.set(entry.recordIds.length)
      }
      refreshAgentReadIds()
      revision.set(revision() + 1)
    })
  }
  const applyThisFilter = (admin: OtlpAdmin, entry: AdminMcpCallEntry) => {
    if (!entry.filter) return
    ADMIN_FRAME.run(() => {
      admin.pendingCalculatorDraft.set(mcpFilterToCalculatorDraft(entry.filter!))
    })
  }
  const showOnTimeline = (admin: OtlpAdmin, entry: AdminMcpCallEntry) => {
    ADMIN_FRAME.run(() => {
      const loaded = new Set(admin.records().map((record) => record.id))
      const firstId = entry.recordIds.find((id) => loaded.has(id))
      const first = admin.records().find((record) => record.id === firstId)
      if (first) admin.selectRecord(first)
      admin.view.set('timeline')
      admin.timelineUnit.set('records')
    })
  }
  return {
    revision,
    agentReadIds,
    lastReadCount,
    entries,
    writeCount,
    totalMs,
    push,
    applyThisFilter,
    showOnTimeline,
  }
}

export function mcpCallLog(): AdminMcpCallLog {
  if (callLogModel === null) {
    callLogModel = ADMIN_FRAME.run(createMcpCallLog)
  }
  return callLogModel
}

function clearCallLogAtoms() {
  storedEntries = []
  if (callLogModel === null) return
  ADMIN_FRAME.run(() => {
    callLogModel!.agentReadIds.set(new Set<string>())
    callLogModel!.lastReadCount.set(0)
    callLogModel!.revision.set(callLogModel!.revision() + 1)
  })
}

export function resetMcpCallLog(): void {
  clearCallLogAtoms()
}

onAdminReset(() => {
  clearCallLogAtoms()
})
