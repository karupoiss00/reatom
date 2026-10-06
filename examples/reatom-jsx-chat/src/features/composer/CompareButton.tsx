import { computed } from '@reatom/core'

import { extraEstimateLines } from '../../app/ui'
import { modelName } from '../../catalog'
import {
  bindCompareChrome,
  compareSession,
  pairedEstimate,
  sameModelNote,
  syncCompareEstimate,
} from '../../chat/compare'
import { formatEstimate } from '../../money'
import type { ChatSlotProps } from '../slots'

const hold = 'Pick a reply to continue'
const different = 'Pick a different model.'

const rowCss = `
  display: contents;
`

const captionCss = `
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
`

export const CompareButton = ({ chat }: ChatSlotProps) => {
  const quote = computed(() => {
    const session = compareSession()
    if (!session || session.phase !== 'armed' || session.chatId !== chat.id) {
      return null
    }
    const amount = pairedEstimate(chat, session.models)
    return amount === null ? null : formatEstimate(amount)
  }, `features.compare.button#${chat.id}.quote`)
  const armedModel = computed(() => {
    const session = compareSession()
    if (!session || session.chatId !== chat.id || session.phase !== 'armed') {
      return null
    }
    return session.models[1]
  }, `features.compare.button#${chat.id}.second`)
  const pending = computed(() => {
    const session = compareSession()
    return session?.phase === 'pending' && session.chatId === chat.id
  }, `features.compare.button#${chat.id}.pending`)

  return (
    <span
      data-slot="CompareButton"
      css="display: contents;"
      ref={(root: HTMLSpanElement) => {
        const form = root.closest('form')
        const textarea = form?.querySelector('textarea')
        const sync = () => {
          const session = compareSession()
          const showEstimate =
            session?.phase === 'armed' && session.chatId === chat.id
          syncCompareEstimate(showEstimate)
          const blocked = session?.phase === 'pending' && session.chatId === chat.id
          form?.toggleAttribute('data-compare-pending', blocked)
          if (textarea) textarea.readOnly = blocked
        }
        sync()
        const unbind = bindCompareChrome()
        const stopSession = compareSession.subscribe(sync)
        const stopLines = extraEstimateLines.subscribe(() => {
          const session = compareSession()
          if (session?.phase === 'armed' && session.chatId === chat.id) {
            syncCompareEstimate(true)
          }
        })
        return () => {
          unbind()
          stopSession()
          stopLines()
          form?.removeAttribute('data-compare-pending')
          if (textarea) textarea.readOnly = false
          syncCompareEstimate(false)
        }
      }}
    >
      <style>{`
        [data-compare-pending] textarea {
          color: transparent;
          caret-color: transparent;
        }

        [data-composer-tools]:has([data-compare-row]) {
          flex-wrap: wrap;
          row-gap: var(--space-2);
        }
      `}</style>
      {() => {
        const modelId = armedModel()
        const amount = quote()
        const note = sameModelNote()
        const held = pending()
        if (!modelId && !amount && !note && !held) return null
        return (
          <span data-compare-row="" css={rowCss}>
            {modelId ? (
              <span
                data-compare-model={modelId}
                css={`
                  display: inline-flex;
                  align-items: center;
                  flex: 0 1 auto;
                  min-width: 0;
                  max-width: min(18rem, 100%);
                  box-sizing: border-box;
                  overflow: hidden;
                  height: var(--control-height-compact);
                  min-height: var(--control-height-compact);
                  padding: 0 var(--space-3);
                  border: 1px solid var(--line-strong);
                  border-radius: var(--radius-pill);
                  background: var(--accent-soft);
                  color: var(--accent-text);
                  font-size: var(--text-sm);
                  font-weight: var(--weight-medium);
                  line-height: var(--leading-none);
                `}
              >
                <span
                  css={`
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                  `}
                >
                  {modelName(modelId)}
                </span>
              </span>
            ) : null}
            {note ? (
              <span
                data-compare-notice=""
                css={`
                  ${captionCss}
                  flex: 1 1 100%;
                  color: var(--warning);
                `}
              >
                {different}
              </span>
            ) : null}
            {amount ? (
              <span
                data-compare-estimate=""
                css={`
                  ${captionCss}
                  color: var(--text-muted);
                  font-variant-numeric: tabular-nums;
                `}
              >
                {amount} · Sends 2 requests
              </span>
            ) : null}
            {held ? (
              <span
                data-compare-hold=""
                css={`
                  ${captionCss}
                  flex: 1 1 auto;
                  color: var(--text);
                `}
              >
                {hold}
              </span>
            ) : null}
          </span>
        )
      }}
    </span>
  )
}
