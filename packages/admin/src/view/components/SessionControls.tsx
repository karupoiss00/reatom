import { atom } from '@reatom/core'

import type { Admin } from '../../index'
import type { AdminAtom, AdminFrame, AdminSession } from '../../types'
import { Icon } from '../design-system'
import { buttonGhost, colors, flex } from '../styles'

export interface SessionControlsProps {
  admin: Admin
}

interface ImportedSessionPayload {
  session: AdminSession
  atoms: Record<string, AdminAtom>
  frames: Array<AdminFrame>
}

type ConfirmAction = 'clear' | 'fresh' | null

const secondaryControlButton = `
  ${buttonGhost}
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.64rem;
  white-space: nowrap;
  min-height: 1.55rem;
  padding-inline: 0.35rem;
  padding-block: 0.16rem;
`

const menuControlButton = `
  ${secondaryControlButton}
  width: 100%;
  justify-content: flex-start;
  min-height: 1.75rem;
  border-color: transparent;
`

function downloadJson(filename: string, data: unknown): void {
  const serialized = JSON.stringify(data, null, 2)
  const blob = new Blob([serialized], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function isImportedSessionPayload(
  value: unknown,
): value is ImportedSessionPayload {
  if (!value || typeof value !== 'object') return false

  if (!('session' in value) || !('atoms' in value) || !('frames' in value)) {
    return false
  }

  const session = value.session
  const atoms = value.atoms
  const frames = value.frames

  return (
    !!session &&
    typeof session === 'object' &&
    'id' in session &&
    typeof session.id === 'string' &&
    'startedAt' in session &&
    typeof session.startedAt === 'number' &&
    !!atoms &&
    typeof atoms === 'object' &&
    Array.isArray(frames)
  )
}

export const SessionControls = ({ admin }: SessionControlsProps) => {
  const confirmAction = atom<ConfirmAction>(
    null,
    '_Admin.view.sessionControls.confirm',
  )
  const importFeedback = atom<string | null>(
    null,
    '_Admin.view.sessionControls.importFeedback',
  )
  const importFeedbackTone = atom<'error' | 'success'>(
    'error',
    '_Admin.view.sessionControls.importFeedbackTone',
  )

  let confirmTimer: ReturnType<typeof setTimeout> | null = null
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null
  let importInput: HTMLInputElement | null = null

  const clearConfirmTimer = () => {
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer)
      confirmTimer = null
    }
  }

  const scheduleConfirmRevert = () => {
    clearConfirmTimer()
    confirmTimer = setTimeout(() => {
      confirmAction.set(null)
      confirmTimer = null
    }, 3000)
  }

  const showFeedback = (message: string, tone: 'error' | 'success') => {
    if (feedbackTimer !== null) {
      clearTimeout(feedbackTimer)
      feedbackTimer = null
    }
    importFeedbackTone.set(tone)
    importFeedback.set(message)
    if (tone === 'success') {
      feedbackTimer = setTimeout(() => {
        importFeedback.set(null)
        feedbackTimer = null
      }, 2500)
    }
  }

  const clearWorkspace = () => {
    admin.reporter.clear()
    admin.store.clear()
  }

  const startFreshSession = () => {
    admin.session.start()
    admin.reporter.clear()
    admin.store.clear()
  }

  return (
    <div
      css={`
        ${flex}
        gap: var(--admin-space-4);
        flex-wrap: nowrap;
        align-items: center;
        position: relative;
      `}
    >
      <button
        type="button"
        title="Export session"
        css={secondaryControlButton}
        on:click={() => {
          confirmAction.set(null)
          clearConfirmTimer()
          importFeedback.set(null)
          const session = admin.store.exportSession()
          downloadJson(
            `reatom-admin-session-${session.session.id}.json`,
            session,
          )
        }}
      >
        <Icon name="export" />
        Export
      </button>
      <details
        data-session-menu=""
        css={`
          position: relative;
          & > summary {
            ${buttonGhost}
            width: 1.75rem;
            height: 1.75rem;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            list-style: none;
          }
          & > summary::-webkit-details-marker {
            display: none;
          }
          &[open] > summary {
            border-color: ${colors.accent};
            color: ${colors.text};
          }
        `}
      >
        <summary aria-label="Session actions" title="Session actions">
          <Icon name="more" />
        </summary>
        <div
          css={`
            position: absolute;
            z-index: 10;
            inset-inline-end: 0;
            top: calc(100% + var(--admin-space-4));
            width: 11rem;
            display: grid;
            gap: var(--admin-space-2);
            padding: var(--admin-space-6);
            border: 1px solid ${colors.borderStrong};
            border-radius: var(--admin-radius-4);
            background: ${colors.surface};
          `}
        >
          {() =>
            admin.store.source() === 'replay' ? (
              <button
                type="button"
                css={menuControlButton}
                on:click={() => {
                  confirmAction.set(null)
                  clearConfirmTimer()
                  importFeedback.set(null)
                  admin.store.returnToLive()
                }}
              >
                <Icon name="play" />
                Return to live
              </button>
            ) : null
          }
          <button
            type="button"
            aria-pressed={() => admin.reporter.paused()}
            css={`
              ${menuControlButton}
              color: ${colors.success};
              &[aria-pressed='true'] {
                color: ${colors.warning};
                background: ${colors.warningSoft};
              }
            `}
            on:click={() => {
              confirmAction.set(null)
              clearConfirmTimer()
              importFeedback.set(null)
              if (admin.reporter.paused()) {
                admin.reporter.paused.setFalse()
                return
              }
              admin.reporter.paused.setTrue()
            }}
          >
            {() =>
              admin.reporter.paused() ? (
                <>
                  <Icon name="play" />
                  Resume capture
                </>
              ) : (
                <>
                  <Icon name="pause" />
                  Pause capture
                </>
              )
            }
          </button>
          {() =>
            admin.reporter.paused() ? (
              <span
                aria-live="polite"
                css={`
                  position: absolute;
                  width: 1px;
                  height: 1px;
                  padding: 0;
                  margin: -1px;
                  overflow: hidden;
                  clip: rect(0, 0, 0, 0);
                  white-space: nowrap;
                  border: 0;
                `}
              >
                Recording paused
              </span>
            ) : null
          }
          <button
            type="button"
            title="Import replay"
            css={menuControlButton}
            on:click={() => {
              confirmAction.set(null)
              clearConfirmTimer()
              importInput?.click()
            }}
          >
            <Icon name="import" />
            Import
          </button>
          <button
            type="button"
            title="Clear workspace"
            data-armed={() => (confirmAction() === 'clear' ? 'true' : 'false')}
            css={`
              ${menuControlButton}
              &[data-armed='true'] {
                border-color: ${colors.error};
                color: ${colors.error};
                background: ${colors.errorSoft};
              }
            `}
            on:click={() => {
              if (confirmAction() === 'clear') {
                clearConfirmTimer()
                confirmAction.set(null)
                importFeedback.set(null)
                clearWorkspace()
                return
              }
              confirmAction.set('clear')
              scheduleConfirmRevert()
            }}
          >
            {() => (confirmAction() === 'clear' ? 'Confirm clear' : 'Clear')}
          </button>
          <button
            type="button"
            title="Start fresh session"
            data-armed={() => (confirmAction() === 'fresh' ? 'true' : 'false')}
            css={`
              ${menuControlButton}
              &[data-armed='true'] {
                border-color: ${colors.error};
                color: ${colors.error};
                background: ${colors.errorSoft};
              }
            `}
            on:click={() => {
              if (confirmAction() === 'fresh') {
                clearConfirmTimer()
                confirmAction.set(null)
                importFeedback.set(null)
                startFreshSession()
                return
              }
              confirmAction.set('fresh')
              scheduleConfirmRevert()
            }}
          >
            {() => (confirmAction() === 'fresh' ? 'Confirm fresh' : 'Fresh')}
          </button>

          {() => {
            const message = importFeedback()
            if (!message) return null
            const tone = importFeedbackTone()
            return (
              <span
                role="status"
                css={`
                  font-size: 0.68rem;
                  color: ${tone === 'error' ? colors.error : colors.success};
                `}
              >
                {message}
              </span>
            )
          }}
        </div>
      </details>
      <input
        type="file"
        accept="application/json"
        ref={(element) => {
          importInput = element
          return () => {
            if (importInput === element) importInput = null
          }
        }}
        css={`
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        `}
        on:change={(event: Event) => {
          const target = event.currentTarget
          if (!(target instanceof HTMLInputElement)) return
          const file = target.files?.[0]
          if (!file) return

          const reader = new FileReader()
          reader.onload = () => {
            try {
              if (typeof reader.result !== 'string') {
                showFeedback('Import failed: empty file', 'error')
                return
              }
              const parsed: unknown = JSON.parse(reader.result)
              if (!isImportedSessionPayload(parsed)) {
                showFeedback('Import failed: invalid session payload', 'error')
                return
              }
              admin.store.importSession(parsed)
              showFeedback('Replay loaded', 'success')
            } catch {
              showFeedback('Import failed: could not parse JSON', 'error')
            }
          }
          reader.onerror = () => {
            showFeedback('Import failed: could not read file', 'error')
          }
          reader.readAsText(file)
          target.value = ''
        }}
      />
    </div>
  )
}
