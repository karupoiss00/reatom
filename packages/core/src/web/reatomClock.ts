import type { Atom } from '../core'
import { atom, bind, isConnected, named, withMiddleware } from '../core'
import { withConnectHook, withInitHook } from '../extensions'
import { wrap } from '../methods'
import { MAX_SAFE_TIMEOUT, sleep } from '../utils'

export interface ClockOptions {
  /**
   * Tick interval in milliseconds.
   *
   * @default 1000
   */
  interval?: number
  /**
   * When `true`, the clock starts on the first read and keeps ticking after
   * disconnect. When `false` (default), it ticks only while subscribed.
   *
   * @default false
   */
  hot?: boolean
  /**
   * When `true`, reads without subscribers return the current `Date.now()`
   * instead of the last tick. This also makes the first value a reconnecting
   * subscriber sees fresh, since the connect hook (and so the first tick) runs
   * deferred. When `false` (default), the value stays frozen while idle.
   *
   * @default false
   */
  fresh?: boolean
  /** Debug name for the atom. */
  name?: string
}

/**
 * Creates a wall-clock atom that ticks every `interval` ms.
 *
 * The atom state is `Date.now()`. By default (`hot: false`) ticking starts on
 * the first subscriber and stops when the last subscriber disconnects. Pass
 * `hot: true` to start on the first read and keep ticking forever — same
 * lifetime as {@link rAF}.
 *
 * Prefer the ready-made {@link clock} singleton for second-resolution wall time.
 * Use this factory when you need a custom interval, a named instance, or a hot
 * clock.
 *
 * @example
 *   const seconds = reatomClock(1000, 'seconds')
 *   seconds.subscribe((now) => console.log(new Date(now).toISOString()))
 *
 * @example
 *   // Keep ticking even with no subscribers (like rAF)
 *   const hotClock = reatomClock({
 *     interval: 1000,
 *     hot: true,
 *     name: 'hotClock',
 *   })
 *
 * @example
 *   // Idle reads and reconnects always see the current time
 *   const freshClock = reatomClock({ fresh: true, name: 'freshClock' })
 *
 * @example
 *   // Relative "updated 5s ago" label
 *   const updatedAt = atom(Date.now(), 'updatedAt')
 *   const secondsAgo = computed(() => {
 *     clock()
 *     return Math.floor((Date.now() - updatedAt()) / 1000)
 *   }, 'secondsAgo')
 *
 * @param options - Interval in ms, or an options object
 * @param name - Debug name when the first argument is an interval number
 * @returns An atom holding the current timestamp
 * @see {@link clock} Prebuilt `reatomClock(1000)` singleton
 * @see {@link rAF} Frame-clock sibling for animation timing
 */
export let reatomClock = (
  options: number | ClockOptions = {},
  name?: string,
): Atom<number> => {
  const {
    interval = 1000,
    hot = false,
    fresh = false,
    name: nameFromOptions,
  }: ClockOptions = typeof options === 'number'
    ? { interval: options }
    : options

  const atomName = nameFromOptions ?? name ?? named('_clock')
  const delay = Math.min(MAX_SAFE_TIMEOUT, Math.max(1, interval))

  const clockAtom = atom(() => Date.now(), atomName)

  if (fresh) {
    clockAtom.extend(
      withMiddleware(
        () =>
          function clockFreshRead(next, ...params) {
            const isIdleRead = params.length === 0 && !isConnected(clockAtom)
            return isIdleRead ? next(Date.now()) : next(...params)
          },
        'read',
      ),
    )
  }

  return clockAtom.extend(
    hot
      ? withInitHook((_initState, target) => {
          setInterval(
            bind(() => target.set(Date.now())),
            delay,
          )
        }, 'effect')
      : withConnectHook(async (target) => {
          while (true) {
            await wrap(sleep(delay))
            target.set(Date.now())
          }
        }),
  )
}

/**
 * Prebuilt wall-clock atom that ticks every second while subscribed.
 *
 * Wall-time sibling of {@link rAF}: `rAF` answers "what frame is it?", `clock`
 * answers "what time is it?".
 *
 * @example
 *   import { clock, computed } from '@reatom/core'
 *
 *   const nowLabel = computed(
 *     () => new Date(clock()).toLocaleTimeString(),
 *     'nowLabel',
 *   )
 */
export let clock = /* @__PURE__ */ reatomClock(1000, '_clock')
