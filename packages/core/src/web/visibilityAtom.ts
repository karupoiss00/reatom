import type { Atom } from '../core'
import { atom } from '../core'
import { reatomObservable } from '../methods'
import { isBrowser } from '../utils'
import { onEvent } from './onEvent'

type VisibilityAtom = Atom<DocumentVisibilityState> & {
  /** Time stamp of transition to the `visible` state. */
  visibleAtAtom: Atom<number | undefined>
  /** Time stamp of transition to the `hidden` state. */
  hiddenAtAtom: Atom<number | undefined>
}

/**
 * An atom that tracks the page visibility state (`document.visibilityState`).
 *
 * Returns `'visible'` when the page content is at least partially visible and
 * `'hidden'` when the tab is in the background, the window is minimized, or the
 * screen is locked. Automatically updates by listening to the document's
 * `visibilitychange` event.
 *
 * Provides additional timestamp tracking:
 *
 * - `visibleAtAtom`: Timestamp (from `Date.now()`) when the page became visible
 * - `hiddenAtAtom`: Timestamp (from `Date.now()`) when the page became hidden
 *
 * @example
 *   import { effect, visibilityAtom } from '@reatom/core'
 *
 *   effect(() => {
 *     const visibility = visibilityAtom()
 *     const hiddenAt = visibilityAtom.hiddenAtAtom()
 *
 *     if (visibility === 'visible') {
 *       if (hiddenAt && Date.now() - hiddenAt > 60_000) {
 *         refetchStaleData()
 *       }
 *     } else {
 *       pausePolling()
 *     }
 *   })
 */
const initVisibilityAtom = () =>
  reatomObservable(
    () => ({
      getState: () => (isBrowser() ? document.visibilityState : 'visible'),
      subscribe: (fn) => {
        if (!isBrowser()) return
        onEvent(document, 'visibilitychange', () => {
          const state = document.visibilityState
          fn(state)
          if (state === 'visible') {
            visibilityAtom.visibleAtAtom.set(Date.now())
          } else {
            visibilityAtom.hiddenAtAtom.set(Date.now())
          }
        })
      },
    }),
    'visibility',
  ).extend(() => ({
    visibleAtAtom: atom<number | undefined>(
      undefined,
      'visibility.visibleAtAtom',
    ),
    hiddenAtAtom: atom<number | undefined>(
      undefined,
      'visibility.hiddenAtAtom',
    ),
  }))

export let visibilityAtom: VisibilityAtom = /* @__PURE__ */ initVisibilityAtom()
