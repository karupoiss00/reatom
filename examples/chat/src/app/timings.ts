import { onRuntimeReset } from '../platform/runtime'

export interface Timings {
  undoMs: number
  generationCapMs: number
  flushMs: number
  keyMetaThrottleMs: number
}

export const defaultTimings: Readonly<Timings> = {
  undoMs: 8000,
  generationCapMs: 60000,
  flushMs: 500,
  keyMetaThrottleMs: 10000,
}

export const timings: Timings = { ...defaultTimings }

const restoreDefaultTimings = () => {
  Object.assign(timings, defaultTimings)
}

export const overrideTimings = (overrides: Partial<Timings> = {}): void => {
  Object.assign(timings, defaultTimings, overrides)
  onRuntimeReset(restoreDefaultTimings)
}
