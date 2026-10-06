import {
  action,
  atom,
  isAbort,
  peek,
  sleep,
  withAbort,
  withAsync,
  withChangeHook,
  withConnectHook,
  wrap,
} from '@reatom/core'

import { upsertChatRecord } from '../../../chat/library'
import { publishSync } from '../../../chat/syncPublisher'
import { now } from '../../../platform/env'
import { recordWriteFailure } from '../../../storage/health'
import { mergeChatRecord } from '../../../storage/records'
import { repo } from '../../../storage/repo'
import type { WriteFailure } from '../../../storage/types'
import { AutoGrowTextarea, uniqueId } from '../../../ui'
import type { ChatSlotProps } from '../../slots'

const promptSaveDelayMs = 200

const failedPromptWrites = atom(
  new Set<string>(),
  'features.prompt.failedWrites',
)

export const promptSaveFailed = (id: string) => failedPromptWrites().has(id)

const markPromptSave = (id: string, failed: boolean) => {
  failedPromptWrites.set((current) => {
    if (current.has(id) === failed) return current
    const next = new Set(current)
    if (failed) next.add(id)
    else next.delete(id)
    return next
  })
}

const writeReason = (error: unknown): WriteFailure['reason'] => {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : ''
  if (name === 'QuotaExceededError' || /quota/i.test(message)) return 'quota'
  if (
    name === 'InvalidStateError' ||
    name === 'TransactionInactiveError' ||
    name === 'UnknownError' ||
    name === 'TimeoutError' ||
    name === 'NotReadableError'
  ) {
    return 'blocked'
  }
  return 'unknown'
}

export const PromptSection = ({ chat }: ChatSlotProps) => {
  const name = `features.prompt.${chat.id}`
  const fieldId = uniqueId('system-prompt')
  const hintId = `${fieldId}-hint`
  const statusId = `${fieldId}-status`
  const draft = atom(peek(chat.settings).systemPrompt, `${name}.draft`)
  let nextPromptStamp = 0
  const promptStamp = () => {
    const at = Math.max(now(), nextPromptStamp + 1)
    nextPromptStamp = at
    return at
  }

  const persist = action(async (immediate: boolean) => {
    if (!immediate) await wrap(sleep(promptSaveDelayMs))
    const text = draft()
    const id = chat.id
    if (id === 'new') {
      if (chat.settings().systemPrompt !== text) {
        chat.updateSettings({ systemPrompt: text })
      }
      markPromptSave(id, false)
      return
    }
    const savedSettings = chat.settings()
    const before = savedSettings.systemPrompt
    if (before === text) {
      markPromptSave(id, false)
      return
    }
    const restore = () => {
      const current = chat.record()
      if (!current || current.settings.systemPrompt === before) return
      upsertChatRecord({
        ...current,
        settings: { ...current.settings, systemPrompt: before },
      })
    }
    let superseded = false
    const at = promptStamp()
    const put = repo.putChatFields(
      id,
      { settings: { ...savedSettings, systemPrompt: text } },
      at,
      { mirrorRejected: false },
    )
    void put
      .then(async () => {
        if (!superseded) return
        const durable = await repo.getChat(id)
        if (durable?.settings.systemPrompt !== text) return
        await repo.putChatFields(
          id,
          { settings: { ...savedSettings, systemPrompt: before } },
          at,
          { mirrorRejected: false },
        )
      })
      .catch(() => {})
    let committed = false
    try {
      const stored = await wrap(put)
      if (superseded) return
      committed = true
      const current = chat.record()
      const saved = current ? mergeChatRecord(current, stored) : stored
      upsertChatRecord(saved)
      publishSync({ type: 'chat', chat: stored })
      if (draft() !== text) return
      markPromptSave(id, false)
    } catch (error) {
      if (isAbort(error)) {
        superseded = true
        if (!committed) restore()
        return
      }
      markPromptSave(id, true)
      restore()
      recordWriteFailure(writeReason(error))
    }
  }, `${name}.persist`).extend(withAsync(), withAbort())

  draft.extend(
    withChangeHook(() => {
      persist(false).catch(() => {})
    }),
  )
  draft.extend(
    withConnectHook((target) =>
      chat.settings.subscribe((settings) => {
        if (promptSaveFailed(chat.id)) return
        if (target() === settings.systemPrompt) return
        target.set(settings.systemPrompt)
      }),
    ),
  )

  return (
    <section
      data-slot="PromptSection"
      aria-label="System prompt"
      css={`
        display: grid;
        align-content: start;
        gap: var(--space-4);
        min-width: 0;
        max-width: 36rem;
      `}
    >
      <div css="display: grid; gap: var(--space-1); min-width: 0;">
        <label
          for={fieldId}
          css={`
            margin: 0;
            font-family: var(--font-display);
            font-size: var(--text-lg);
            font-weight: var(--weight-medium);
            line-height: var(--leading-tight);
            letter-spacing: var(--tracking-display);
          `}
        >
          System prompt
        </label>
        <p
          id={hintId}
          css={`
            margin: 0;
            color: var(--text-muted);
            font-size: var(--text-sm);
            line-height: var(--leading-snug);
            text-wrap: pretty;
          `}
        >
          The next message includes this prompt. Messages already in the chat
          stay unchanged.
        </p>
      </div>
      <AutoGrowTextarea
        id={fieldId}
        value={draft}
        label="System prompt"
        rows={6}
        attr:aria-describedby={() =>
          promptSaveFailed(chat.id) ? `${hintId} ${statusId}` : hintId
        }
        attr:aria-invalid={() => (promptSaveFailed(chat.id) ? 'true' : 'false')}
      />
      {() =>
        promptSaveFailed(chat.id) ? (
          <p
            id={statusId}
            role="status"
            data-prompt-save="failed"
            css={`
              margin: 0;
              color: var(--danger);
              font-size: var(--text-sm);
              font-weight: var(--weight-semibold);
              line-height: var(--leading-snug);
            `}
          >
            Not saved
          </p>
        ) : null
      }
    </section>
  )
}
