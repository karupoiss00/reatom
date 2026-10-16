import type { AtomLike, Frame } from '@reatom/core'
import { _enqueue } from '@reatom/core'

import type { OtlpAttrValue } from './toOtlpValue.ts'

const FRAME_ID_SLOT = 'var#otel.frame.id' as const
const INSTANCE_IN_NAME = /#([^.#]+)/

export type ParsedReatomName = {
  raw: string
  spanName: string
  instance?: string
}

export type ReatomPrimitiveKind = 'action' | 'atom' | 'computed'

export const parseInstanceName = (raw: string): ParsedReatomName => {
  const match = INSTANCE_IN_NAME.exec(raw)
  if (!match) return { raw, spanName: raw }
  return {
    raw,
    spanName: raw.replace(INSTANCE_IN_NAME, '#'),
    instance: match[1],
  }
}

export const reatomPrimitiveKind = (target: AtomLike): ReatomPrimitiveKind => {
  if (target.__reatom.reactive !== true) return 'action'
  return target.__reatom.writable ? 'atom' : 'computed'
}

export const readFrameId = (frame: Frame): string | undefined => {
  const id = frame[FRAME_ID_SLOT]
  return typeof id === 'string' ? id : undefined
}

const isRootFrame = (frame: Frame): boolean => frame === frame.root.frame

const pushCauseId = (ids: string[], seen: Set<string>, cause: Frame | null) => {
  if (!cause || isRootFrame(cause)) return
  const id = readFrameId(cause)
  if (id === undefined || seen.has(id)) return
  seen.add(id)
  ids.push(id)
}

const MAX_UNINSTRUMENTED_CAUSE_DEPTH = 16
const MAX_UNINSTRUMENTED_CAUSE_FRAMES = 16

const walkUninstrumented = (
  start: Frame,
  changed: WeakSet<Frame>,
  seen: Set<Frame>,
  onChanged: (cause: Frame) => void,
) => {
  let framesLeft = MAX_UNINSTRUMENTED_CAUSE_FRAMES
  const walk = (frame: Frame, depth: number) => {
    if (
      depth > MAX_UNINSTRUMENTED_CAUSE_DEPTH ||
      framesLeft <= 0 ||
      seen.has(frame) ||
      isRootFrame(frame)
    ) {
      return
    }
    framesLeft--
    if (changed.has(frame)) {
      seen.add(frame)
      onChanged(frame)
      return
    }
    if (readFrameId(frame) !== undefined) {
      seen.add(frame)
      return
    }
    seen.add(frame)
    if (depth === MAX_UNINSTRUMENTED_CAUSE_DEPTH) return
    for (let i = 0; i < frame.pubs.length; i++) {
      const pub = frame.pubs[i]
      if (pub) walk(pub, depth + 1)
    }
  }
  walk(start, 1)
}

export const collectCauseIds = (
  frame: Frame,
  changed: WeakSet<Frame>,
): string[] => {
  const ids: string[] = []
  const seenIds = new Set<string>()
  const seenFrames = new Set<Frame>()
  const take = (cause: Frame) => pushCauseId(ids, seenIds, cause)
  const caller = frame.pubs[0]
  if (caller && !isRootFrame(caller)) {
    if (changed.has(caller) || readFrameId(caller) !== undefined) {
      seenFrames.add(caller)
      take(caller)
    } else walkUninstrumented(caller, changed, seenFrames, take)
  }
  for (let i = 1; i < frame.pubs.length; i++) {
    const pub = frame.pubs[i]
    if (!pub || isRootFrame(pub) || seenFrames.has(pub)) continue
    if (changed.has(pub)) {
      seenFrames.add(pub)
      take(pub)
      continue
    }
    if (readFrameId(pub) !== undefined) continue
    walkUninstrumented(pub, changed, seenFrames, take)
  }
  return ids
}

export type TracePair = { traceId: string; spanId: string }

export type TracedCause = TracePair & {
  frameId: string
  changedOrder: number
}

/**
 * Last `markChanged` write in the batch is primary; one cause per other
 * `traceId`.
 */
export const pickCrossTraceCauses = (
  traced: readonly TracedCause[],
): { primary: TracedCause; others: TracedCause[] } | undefined => {
  const latestByTrace = new Map<string, TracedCause>()
  for (const cause of traced) {
    const previous = latestByTrace.get(cause.traceId)
    if (!previous || cause.changedOrder > previous.changedOrder) {
      latestByTrace.set(cause.traceId, cause)
    }
  }
  if (latestByTrace.size < 2) return undefined
  let primary: TracedCause | undefined
  for (const cause of latestByTrace.values()) {
    if (!primary || cause.changedOrder > primary.changedOrder) primary = cause
  }
  const others = [...latestByTrace.values()].filter(
    (cause) => cause.traceId !== primary!.traceId,
  )
  return { primary: primary!, others }
}

const collectTracedCauses = (
  frame: Frame,
  changed: WeakSet<Frame>,
  traces: WeakMap<Frame, TracedCause>,
): TracedCause[] => {
  const result: TracedCause[] = []
  const seen = new Set<Frame>()
  const take = (cause: Frame) => {
    const traced = traces.get(cause)
    if (traced) result.push(traced)
  }
  const consider = (cause: Frame | null | undefined) => {
    if (!cause || isRootFrame(cause) || seen.has(cause)) return
    if (changed.has(cause)) {
      seen.add(cause)
      take(cause)
      return
    }
    if (readFrameId(cause) !== undefined) return
    walkUninstrumented(cause, changed, seen, take)
  }
  consider(frame.pubs[0])
  for (let i = 1; i < frame.pubs.length; i++) consider(frame.pubs[i])
  return result
}

export const recordNameAttributes = (
  parsed: ParsedReatomName,
): Record<string, OtlpAttrValue> => {
  const attributes: Record<string, OtlpAttrValue> = {
    'reatom.name': parsed.raw,
  }
  if (parsed.instance !== undefined) {
    attributes['reatom.instance'] = parsed.instance
  }
  return attributes
}

export const createCauseStore = () => {
  let seq = 0
  let changeSeq = 0
  let changed = new WeakSet<Frame>()
  let traces = new WeakMap<Frame, TracedCause>()
  let cleanupQueued = false

  const queueCleanup = () => {
    if (cleanupQueued) return
    cleanupQueued = true
    _enqueue(() => {
      changed = new WeakSet()
      traces = new WeakMap()
      cleanupQueued = false
    }, 'cleanup')
  }

  return {
    assign(frame: Frame): string {
      const existing = readFrameId(frame)
      if (existing !== undefined) return existing
      const id = String(++seq)
      frame[FRAME_ID_SLOT] = id
      return id
    },
    markChanged(frame: Frame, trace?: TracePair) {
      changed.add(frame)
      queueCleanup()
      if (!trace) return
      const frameId = readFrameId(frame)
      if (frameId === undefined) return
      traces.set(frame, {
        frameId,
        traceId: trace.traceId,
        spanId: trace.spanId,
        changedOrder: ++changeSeq,
      })
    },
    causeIds(frame: Frame): string[] {
      return collectCauseIds(frame, changed)
    },
    tracedCauses(frame: Frame): TracedCause[] {
      return collectTracedCauses(frame, changed, traces)
    },
  }
}

export type CauseStore = ReturnType<typeof createCauseStore>
