import { atom, computed, type Atom } from '@reatom/core'

import { catalogById, modelName } from '../../catalog'
import { formatUsd } from '../../money'
import { webSearchNoticeSeen } from '../../storage/prefs'
import { Banner, Icon, Tooltip } from '../../ui'
import { compactTarget, resetButton } from '../../ui/mixins'
import type { ChatSlotProps } from '../slots'

const mayAddCost = 'Web search may add cost'

const noticeOpenByChat = new Map<string, Atom<boolean>>()

const noticeOpenFor = (chatId: string) => {
  const existing = noticeOpenByChat.get(chatId)
  if (existing) return existing
  const opened = atom(false, `features.webSearch#${chatId}.noticeOpen`)
  noticeOpenByChat.set(chatId, opened)
  return opened
}

const noticeCopy = (modelId: string | null) => {
  const model = modelId ? catalogById().get(modelId) : undefined
  const price = model?.webSearchPrice
  if (price === null || price === undefined) return mayAddCost
  const name = modelId ? modelName(modelId) : 'this model'
  return `Web search adds about ${formatUsd(price)} per search on ${name}, plus extra input tokens.`
}

const noticeVisible = (chat: ChatSlotProps['chat'], noticeOpen: Atom<boolean>) =>
  noticeOpen() && chat.settings().webSearch && !webSearchNoticeSeen()

export const WebSearchNotice = ({ chat }: ChatSlotProps) => {
  const noticeOpen = noticeOpenFor(chat.id)
  const dismiss = () => {
    webSearchNoticeSeen.set(true)
    noticeOpen.set(false)
  }

  return (
    <span css="display: contents;">
      {() => {
        if (!noticeVisible(chat, noticeOpen)) return null
        const copy = noticeCopy(chat.model())
        if (copy === mayAddCost) return null
        return (
          <div
            data-web-search-notice=""
            css={`
              max-width: 46rem;
              margin: 0 auto var(--space-2);
            `}
          >
            <Banner tone="warning" title={copy} onDismiss={dismiss} />
          </div>
        )
      }}
    </span>
  )
}

export const WebSearchToggle = ({ chat }: ChatSlotProps) => {
  const noticeOpen = noticeOpenFor(chat.id)
  const unpricedWarning = computed(() => {
    if (!chat.settings().webSearch) return false
    const modelId = chat.model()
    const price = modelId
      ? catalogById().get(modelId)?.webSearchPrice
      : undefined
    return price == null
  }, `features.webSearch#${chat.id}.unpricedWarning`)

  const toggle = () => {
    const next = !chat.settings().webSearch
    chat.updateSettings({ webSearch: next })
    if (!next) {
      noticeOpen.set(false)
      return
    }
    if (!webSearchNoticeSeen()) noticeOpen.set(true)
  }

  const globeButton = () => (
    <button
      type="button"
      data-web-search-toggle=""
      aria-label="Web search"
      attr:aria-pressed={() => (chat.settings().webSearch ? 'true' : 'false')}
      on:click={toggle}
      css={`
        ${resetButton}
        ${compactTarget('var(--control-height-compact)')}
        --visual-bg: var(--bg-elevated);
        --visual-line: var(--line-strong);
        --visual-shadow: var(--shadow-1);
        --visual-radius: 10px;
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: var(--control-height-compact);
        min-width: var(--control-height-compact);
        height: var(--control-height-compact);
        min-height: var(--control-height-compact);
        color: var(--text-muted);

        &::before {
          inset: 0;
          height: auto;
          transform: none;
          border-radius: 10px;
        }

        &[aria-pressed='true'] {
          --visual-bg: var(--accent-soft);
          --visual-line: var(--accent-soft-hover);
          --visual-shadow: none;
          color: var(--accent-text);
        }

        &:hover:not([aria-pressed='true']) {
          --visual-bg: var(--surface-hover);
        }
      `}
    >
      <Icon name="globe" size="1.05rem" />
    </button>
  )

  return (
    <span
      data-slot="WebSearchToggle"
      css={`
        display: inline-flex;
        flex: none;
        flex-direction: row;
        align-items: center;
        gap: var(--space-1-5);
      `}
    >
      {() =>
        unpricedWarning() ? (
          <Tooltip label={mayAddCost} placement="top-start">
            {globeButton()}
          </Tooltip>
        ) : (
          globeButton()
        )
      }
    </span>
  )
}
