import type { AdminRecord, AdminReatomKind } from '../../otlp'
import { recordHasError } from '../../otlp'
import { kindTokens } from '../design-system/tokens'

export type RecordKindName =
  | 'action'
  | 'atom'
  | 'computed'
  | 'effect'
  | 'log'
  | 'mount'
  | 'route'
  | 'framework'

export type RecordStatusName = 'error' | 'abort' | 'suspense' | 'pending'

const FRAMEWORK_KINDS = new Set<AdminReatomKind>([
  'loader',
  'render',
  'session',
  'page_view',
])

const KIND_WORDS: Record<RecordKindName, string> = {
  action: 'action',
  atom: 'atom',
  computed: 'computed',
  effect: 'effect',
  log: 'LOG',
  mount: 'mount',
  route: 'route',
  framework: 'framework span',
}

const STATUS_WORDS: Record<RecordStatusName, string> = {
  error: 'error',
  abort: 'abort',
  suspense: 'suspense',
  pending: 'in progress',
}

/**
 * Pass `admin.mountLogIds()` so mount logs from `mountLogIds` get the mount
 * kind.
 */
export function recordKindIcon(
  record: AdminRecord,
  mountIds?: ReadonlySet<string>,
): RecordKindName {
  if (record.reatomKind === 'mount' || mountIds?.has(record.id) === true) {
    return 'mount'
  }
  if (record.reatomKind === 'route') return 'route'
  if (
    record.reatomKind !== undefined &&
    FRAMEWORK_KINDS.has(record.reatomKind)
  ) {
    return 'framework'
  }
  if (record.reatomKind === 'atom') return 'atom'
  if (record.reatomKind === 'computed') return 'computed'
  if (record.reatomKind === 'effect') return 'effect'
  if (record.kind === 'span' || record.reatomKind === 'action') return 'action'
  return 'log'
}

export function recordStatusIcon(record: AdminRecord): RecordStatusName | null {
  if (recordHasError(record)) return 'error'
  if (record.outcome === 'abort') return 'abort'
  if (record.outcome === 'suspense') return 'suspense'
  if (record.outcome === 'pending') return 'pending'
  return null
}

export function kindWord(kind: RecordKindName): string {
  return KIND_WORDS[kind]
}

export function statusWord(status: RecordStatusName): string {
  return STATUS_WORDS[status]
}

export function kindColorVar(kind: RecordKindName): string {
  if (
    kind === 'action' ||
    kind === 'atom' ||
    kind === 'computed' ||
    kind === 'effect' ||
    kind === 'log'
  ) {
    return kindTokens[kind]
  }
  return kindTokens.other
}

/**
 * Words after the row name, for `aria-description`. The name stays on
 * `aria-label`.
 */
export function recordRowDescription(
  record: AdminRecord,
  options: {
    spanCount?: number
    duration?: string
    mountIds?: ReadonlySet<string>
  } = {},
): string {
  const status = recordStatusIcon(record)
  const parts = [kindWord(recordKindIcon(record, options.mountIds))]
  if (status) parts.push(statusWord(status))
  if (options.spanCount !== undefined) {
    const noun = options.spanCount === 1 ? 'span' : 'spans'
    parts.push(`${options.spanCount} ${noun}`)
  }
  if (options.duration) parts.push(options.duration)
  return parts.join(', ')
}
