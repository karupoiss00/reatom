import { action, addCallHook, atom } from '@reatom/core'

import { streamLifecycle } from '../chat/engine'
import type { StreamLifecycle } from '../chat/types'
import { visuallyHidden } from './mixins'

type Announcement = { text: string; sequence: number }

const currentAnnouncement = atom<Announcement>(
  { text: '', sequence: 0 },
  'ui.liveRegion.announcement',
)

export const lastAnnouncement = () => currentAnnouncement().text

/**
 * Sends status text to the single polite live region. Each call renders a new
 * text node so assistive tech re-reads repeated messages like "Stopped".
 */
export const announce = action((text: string) => {
  currentAnnouncement.set((previous) => ({
    text,
    sequence: previous.sequence + 1,
  }))
}, 'ui.liveRegion.announce')

const statusAnnouncement = (event: StreamLifecycle) => {
  if (event.type === 'started') return 'Generating reply'
  if (event.type === 'completed') return 'Reply complete'
  if (event.type === 'stopped') return 'Stopped'
  if (event.type === 'failed') return event.title
  return ''
}

const watchStreamStatus = () =>
  addCallHook(streamLifecycle, (event) => {
    const text = statusAnnouncement(event)
    if (text) announce(text)
  })

export const LiveRegion = () => (
  <div
    data-live-region=""
    attr:aria-live="polite"
    attr:aria-atomic="true"
    ref={watchStreamStatus}
    css={visuallyHidden}
  >
    {() => {
      const { text, sequence } = currentAnnouncement()
      return <span data-sequence={String(sequence)}>{text}</span>
    }}
  </div>
)
