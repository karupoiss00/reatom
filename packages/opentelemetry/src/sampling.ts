export type SamplingInput = {
  ratio?: number
  by?: 'trace' | 'session'
  updates?: number
  errors?: 'always'
}

export type ResolvedSampling = {
  ratio: number
  by: 'trace' | 'session'
  updates: number
  errors: 'always'
}

const TRACE_ID_RATIO_MASK = 0xffffffff

export const resolveSampling = (input?: SamplingInput): ResolvedSampling => {
  const ratio =
    typeof input?.ratio === 'number' && Number.isFinite(input.ratio)
      ? Math.min(1, Math.max(0, input.ratio))
      : 1
  return {
    ratio,
    by: input?.by === 'session' ? 'session' : 'trace',
    updates:
      typeof input?.updates === 'number' && Number.isFinite(input.updates)
        ? Math.min(1, Math.max(0, input.updates))
        : 1,
    errors: 'always',
  }
}

export const sampleTraceIdRatio = (traceId: string, ratio: number): boolean => {
  if (ratio >= 1) return true
  if (ratio <= 0) return false
  const upperBound = Math.floor(ratio * TRACE_ID_RATIO_MASK)
  const value = Number.parseInt(traceId.slice(24, 32), 16)
  if (!Number.isFinite(value)) return false
  return value <= upperBound
}

export const parentBasedSampled = (input: {
  parentSampled: boolean | undefined
  traceId: string
  ratio: number
}): boolean => {
  if (input.parentSampled !== undefined) return input.parentSampled
  return sampleTraceIdRatio(input.traceId, input.ratio)
}

export const SPAN_FLAGS_SAMPLED = 0x01
export const SPAN_FLAGS_PARENT_IS_REMOTE = 0x0300

export const otlpSpanFlags = (
  sampled: boolean,
  parentIsRemote: boolean,
): number =>
  (sampled ? SPAN_FLAGS_SAMPLED : 0) |
  (parentIsRemote ? SPAN_FLAGS_PARENT_IS_REMOTE : 0)

const RING_TRACES = 16
const RING_SPANS = 32

export class ErrorRing<T> {
  private readonly traces = new Map<string, T[]>()

  clear() {
    this.traces.clear()
  }

  add(traceId: string, item: T) {
    let items = this.traces.get(traceId)
    if (!items) {
      if (this.traces.size >= RING_TRACES) {
        const oldest = this.traces.keys().next().value
        if (oldest !== undefined) this.traces.delete(oldest)
      }
      items = []
      this.traces.set(traceId, items)
    }
    if (items.length >= RING_SPANS) items.shift()
    items.push(item)
  }

  take(traceId: string): T[] {
    const items = this.traces.get(traceId)
    this.traces.delete(traceId)
    return items ?? []
  }
}

export type TraceSamplingDecision = {
  sampled: boolean
  remote: boolean
}

const MAX_TRACE_DECISIONS = 1024

export class TraceSampler {
  private readonly decisions = new Map<string, TraceSamplingDecision>()
  private sessionSampled: boolean | undefined

  constructor(
    private readonly samplingOf: () => ResolvedSampling,
    private readonly sessionTraceId: () => string,
  ) {}

  decisionCount() {
    return this.decisions.size
  }

  remote(traceId: string, sampled: boolean) {
    this.note(traceId, { sampled, remote: true })
  }

  root(traceId: string): TraceSamplingDecision {
    const existing = this.decisions.get(traceId)
    if (existing) return existing
    const decision: TraceSamplingDecision = {
      sampled: this.sampleRoot(traceId),
      remote: false,
    }
    this.note(traceId, decision)
    return decision
  }

  of(traceId: string): TraceSamplingDecision {
    return this.decisions.get(traceId) ?? this.root(traceId)
  }

  promote(traceId: string): TraceSamplingDecision {
    const decision = this.of(traceId)
    decision.sampled = true
    return decision
  }

  private note(traceId: string, decision: TraceSamplingDecision) {
    this.decisions.set(traceId, decision)
    if (this.decisions.size <= MAX_TRACE_DECISIONS) return
    const oldest = this.decisions.keys().next().value
    if (oldest !== undefined) this.decisions.delete(oldest)
  }

  private sampleRoot(traceId: string): boolean {
    const sampling = this.samplingOf()
    if (sampling.by === 'session') {
      this.sessionSampled ??= parentBasedSampled({
        parentSampled: undefined,
        traceId: this.sessionTraceId(),
        ratio: sampling.ratio,
      })
      return this.sessionSampled
    }
    return parentBasedSampled({
      parentSampled: undefined,
      traceId,
      ratio: sampling.ratio,
    })
  }
}
