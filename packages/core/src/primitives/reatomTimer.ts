import type { Action, Atom, Computed } from '../core'
import { action, atom, computed, named, ReatomError } from '../core'
import { withAbort, withChangeHook } from '../extensions'
import { take, wrap } from '../methods'
import { MAX_SAFE_TIMEOUT, sleep } from '../utils'
import { reatomBoolean } from './reatomBoolean'
import type { NumberAtom } from './reatomNumber'
import { reatomNumber } from './reatomNumber'

/** Why a `start` promise settled. */
export type TimerSettleReason = 'complete' | 'stopped' | 'replaced'

/** High-level countdown phase. */
export type TimerStatus = 'idle' | 'running' | 'paused'

export interface TimerAtom extends Atom<number> {
  /** Milliseconds until the countdown target; `0` when idle. */
  remains: Computed<number>
  /** Progress from `0` to `1`, derived from `remains` / duration. */
  progress: Computed<number>
  /**
   * Tick interval in milliseconds; changeable at runtime, applied from the next
   * tick. Must be a positive finite number, otherwise the active `start`
   * rejects and the countdown resets.
   */
  interval: NumberAtom
  /**
   * Pause flag for the active countdown; change it with `pause` / `resume` /
   * `toggle`.
   */
  paused: Computed<boolean>
  /** `'idle' | 'running' | 'paused'`. */
  status: Computed<TimerStatus>
  /** `remains() > 0`. */
  isCounting: Computed<boolean>
  /** Counting and not paused. */
  isRunning: Computed<boolean>
  /** Counting and paused. */
  isPaused: Computed<boolean>
  /**
   * Start a countdown. Resolves with:
   *
   * - `'complete'` — finished naturally
   * - `'stopped'` — `stop()` cancelled this run
   * - `'replaced'` — another `start()` replaced this run
   *
   * Rejects (and resets the countdown) on invalid arguments, an invalid
   * `interval`, or when the caller's frame is aborted.
   */
  start: Action<
    [durationMs: number, passedMs?: number],
    Promise<TimerSettleReason>
  >
  /** Cancel the active countdown (`start` resolves with `'stopped'`). */
  stop: Action<[], void>
  /** Pause while counting; no-op when idle. */
  pause: Action<[], void>
  /** Resume while counting; no-op when idle. */
  resume: Action<[], void>
  /** Toggle pause while counting; no-op when idle. */
  toggle: Action<[], void>
}

export interface TimerOptions {
  name?: string
  /**
   * Tick interval in milliseconds.
   *
   * @default 1000
   */
  interval?: number
  /**
   * Reset `progress` to `0` on `stop`. When `false`, the last progress value is
   * kept after stop.
   *
   * @default true
   */
  resetProgress?: boolean
}

interface TimerRun {
  settleReason: null | Exclude<TimerSettleReason, 'complete'>
}

const isNonNegativeFinite = (value: number) =>
  Number.isFinite(value) && value >= 0

const assertValidInterval = (intervalMs: number) => {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new ReatomError('interval must be a positive finite number')
  }
}

/**
 * Creates a countdown timer.
 *
 * The base state is the internal timestamp of the last tick, used for progress
 * tracking; do not set it manually. Countdown state (`remains`, `progress`,
 * `status`) is derived from that timestamp and an internal target set by
 * `start`. The timer ticks only while a countdown is running.
 *
 * For absolute wall time without a countdown, use {@link clock} /
 * {@link reatomClock}.
 *
 * @example
 *   const otpTimer = reatomTimer({ interval: 1000, name: 'otpTimer' })
 *
 *   const reason = await otpTimer.start(30_000)
 *   if (reason === 'complete') {
 *     otpTimer.remains() // 0
 *     otpTimer.progress() // 1
 *   }
 *
 * @example
 *   const download = reatomTimer('download')
 *   download.start(60_000)
 *   download.pause()
 *   download.resume()
 *   download.toggle()
 *
 * @see {@link clock} Wall-clock singleton
 * @see {@link reatomClock} Custom-interval wall clock
 */
export const reatomTimer = (options: string | TimerOptions = {}): TimerAtom => {
  const {
    name = named('timerAtom'),
    interval: intervalInit = 1000,
    resetProgress = true,
  }: TimerOptions = typeof options === 'string' ? { name: options } : options

  const interval = reatomNumber(intervalInit, `${name}.interval`)
  const pausedState = reatomBoolean(false, `${name}._paused`)
  const target = atom(0, `${name}._target`)
  const duration = atom(0, `${name}._duration`)
  const pauseFrom = atom(0, `${name}._pauseFrom`)
  const progressSnap = atom<null | number>(null, `${name}._progressSnap`)
  const activeRun = atom<null | TimerRun>(null, `${name}._activeRun`)

  const timer = atom(Date.now(), name)

  const paused = computed(() => pausedState(), `${name}.paused`)

  pausedState.extend(
    withChangeHook((isPaused) => {
      if (isPaused) {
        pauseFrom.set(Date.now())
        return
      }

      const pauseFromState = pauseFrom()
      if (!pauseFromState) return

      target.set((prevTarget) =>
        prevTarget > 0 ? prevTarget + (Date.now() - pauseFromState) : 0,
      )
      pauseFrom.set(0)
    }),
  )

  const remains = computed(() => {
    const targetState = target()
    if (targetState <= 0) return 0
    const pauseFromState = pauseFrom()
    return Math.max(0, Math.round(targetState - (pauseFromState || timer())))
  }, `${name}.remains`)

  const progress = computed(() => {
    const progressSnapState = progressSnap()
    if (progressSnapState !== null) return progressSnapState

    const durationState = duration()
    if (durationState <= 0) return 0

    const ratio = Math.min(1, Math.max(0, 1 - remains() / durationState))
    return Math.round(ratio * 100) / 100
  }, `${name}.progress`)

  const status = computed((): TimerStatus => {
    if (remains() <= 0) return 'idle'
    return paused() ? 'paused' : 'running'
  }, `${name}.status`)

  const isCounting = computed(() => status() !== 'idle', `${name}.isCounting`)
  const isRunning = computed(() => status() === 'running', `${name}.isRunning`)
  const isPaused = computed(() => status() === 'paused', `${name}.isPaused`)

  const clearCountdown = (kind: 'complete' | 'stop') => {
    const isStop = kind === 'stop'
    progressSnap.set(isStop && !resetProgress ? progress() : null)
    if (isStop && resetProgress) duration.set(0)

    target.set(0)
    pauseFrom.set(0)
    pausedState.setFalse()
  }

  const runCountdown = action(async (): Promise<TimerSettleReason> => {
    while (true) {
      if (pausedState()) {
        await wrap(take(pausedState))
        continue
      }

      const left = target() - Date.now()
      if (left <= 0) break

      const intervalMs = interval()
      assertValidInterval(intervalMs)
      const tickDelay =
        left < intervalMs ? left : left % intervalMs || intervalMs

      await wrap(sleep(Math.min(MAX_SAFE_TIMEOUT, tickDelay)))
      timer.set(Date.now())
    }

    timer.set(Date.now())
    activeRun.set(null)
    clearCountdown('complete')
    return 'complete'
  }, `${name}._run`).extend(withAbort())

  const start = action(async (durationMs: number, passedMs = 0) => {
    if (!isNonNegativeFinite(durationMs) || !isNonNegativeFinite(passedMs)) {
      throw new ReatomError(
        'duration and passed time must be non-negative finite numbers',
      )
    }
    const intervalMs = interval()
    assertValidInterval(intervalMs)
    if (durationMs < intervalMs) {
      throw new ReatomError('delay less than interval')
    }
    if (durationMs < passedMs) {
      throw new ReatomError('passed more than delay')
    }

    const run: TimerRun = { settleReason: null }
    const prevRun = activeRun()
    if (prevRun) prevRun.settleReason = 'replaced'
    activeRun.set(run)

    const now = Date.now()
    progressSnap.set(null)
    timer.set(now)
    duration.set(durationMs)
    target.set(now + durationMs - passedMs)
    pauseFrom.set(0)
    pausedState.setFalse()

    try {
      return await wrap(runCountdown())
    } catch (error) {
      if (run.settleReason) return run.settleReason

      if (activeRun() === run) {
        activeRun.set(null)
        clearCountdown('stop')
      }
      throw error
    }
  }, `${name}.start`)

  const stop = action(() => {
    const run = activeRun()
    if (run) {
      run.settleReason = 'stopped'
      activeRun.set(null)
      runCountdown.abort('stopped')
    }
    clearCountdown('stop')
  }, `${name}.stop`)

  const pause = action(() => {
    if (remains() > 0) pausedState.setTrue()
  }, `${name}.pause`)

  const resume = action(() => {
    if (remains() > 0) pausedState.setFalse()
  }, `${name}.resume`)

  const toggle = action(() => {
    if (remains() > 0) pausedState.toggle()
  }, `${name}.toggle`)

  return timer.extend(() => ({
    remains,
    progress,
    interval,
    paused,
    status,
    isCounting,
    isRunning,
    isPaused,
    start,
    stop,
    pause,
    resume,
    toggle,
  }))
}
