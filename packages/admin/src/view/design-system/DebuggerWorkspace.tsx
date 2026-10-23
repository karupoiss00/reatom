import { atom, bind, peek, type Atom } from '@reatom/core'

import { Drawer } from './Drawer'
import { isEditableField } from './layer'
import { focusVisible } from './mixins'
import { splitPanePointerMove } from './splitPointer'
import { size, tokens } from './tokens'

/** Shell inline size at which the frame card sits beside the main view. */
export const DEBUGGER_WORKSPACE_SIDE_MIN = 680

const DEBUGGER_WORKSPACE_MIN_MAIN = 280
const DEBUGGER_WORKSPACE_MIN_INSPECTOR = 240
const DEBUGGER_WORKSPACE_DEFAULT_RATIO = 0.62

let workspaceCounter = 0

export interface DebuggerWorkspaceProps {
  header: Element
  filter: Element
  /**
   * The main view element. It stays in one parent so scroll position survives
   * the frame card opening, closing, or the shell crossing 680px. Keep view
   * state in atoms.
   */
  main: Element
  /**
   * Builds the frame card. Called when the card is shown, and again when the
   * shell crosses 680px. Pass null when there is nothing to inspect. Keep card
   * state in atoms.
   */
  inspector: (() => Element) | null
  /**
   * Dialog name when the card is a drawer, and the side region name when it is
   * beside the view.
   */
  inspectorLabel: string | (() => string)
  inspectorOpen: Atom<boolean>
  /** The owner sets `inspectorOpen` false and returns focus to the selected row. */
  onInspectorClose: () => void
  status: Element
}

/**
 * Header, filters, main view, frame card, and status. The frame card is a side
 * pane at 680px and wider, and a bottom drawer below that. The switch uses the
 * shell's width, not the viewport.
 */
export const DebuggerWorkspace = ({
  header,
  filter,
  main,
  inspector,
  inspectorLabel,
  inspectorOpen,
  onInspectorClose,
  status,
}: DebuggerWorkspaceProps) => {
  const workspaceId = ++workspaceCounter
  const narrow = atom(false, `_Admin.debuggerWorkspace.narrow.${workspaceId}`)
  const ratio = atom(
    DEBUGGER_WORKSPACE_DEFAULT_RATIO,
    `_Admin.debuggerWorkspace.ratio.${workspaceId}`,
  )
  const setNarrow = bind((value: boolean) => narrow.set(value))
  const closeInspector = bind(onInspectorClose)

  const readLabel = () =>
    typeof inspectorLabel === 'function' ? inspectorLabel() : inspectorLabel
  const placement = () => {
    if (!inspectorOpen() || inspector === null) return 'closed' as const
    return narrow() ? ('drawer' as const) : ('side' as const)
  }

  return (
    <div
      data-reatom-name="DebuggerWorkspace"
      css={`
        container: admin-shell / inline-size;
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr) auto;
        height: 100%;
        min-height: 0;
        min-width: 0;
        position: relative;
        background: ${tokens.canvas};
        color: ${tokens.text1};
      `}
      ref={(shell) => {
        const syncWidth = () => {
          const width = shell.clientWidth
          if (width === 0) return
          setNarrow(width < DEBUGGER_WORKSPACE_SIDE_MIN)
        }
        syncWidth()
        const observer = new ResizeObserver(syncWidth)
        observer.observe(shell)
        const onKeyDown = bind((event: Event) => {
          if (!(event instanceof KeyboardEvent)) return
          if (event.key !== 'Escape') return
          if (inspector === null || !peek(inspectorOpen) || peek(narrow)) return
          if (isEditableField(event.target)) return
          event.preventDefault()
          event.stopPropagation()
          closeInspector()
        })
        shell.addEventListener('keydown', onKeyDown)
        return () => {
          observer.disconnect()
          shell.removeEventListener('keydown', onKeyDown)
        }
      }}
    >
      <header
        css={`
          min-width: 0;
          padding: var(--admin-space-8);
          border-bottom: 1px solid ${tokens.border1};
        `}
      >
        {header}
      </header>
      <section
        aria-label="Filters"
        css={`
          min-width: 0;
          padding: var(--admin-space-8);
          border-bottom: 1px solid ${tokens.border1};
        `}
      >
        {filter}
      </section>
      <div
        css={`
          min-height: 0;
          min-width: 0;
          position: relative;
        `}
      >
        <div
          data-reatom-name="workspace-body"
          css:split={() => {
            if (placement() !== 'side') return 'minmax(0, 1fr)'
            return `minmax(${DEBUGGER_WORKSPACE_MIN_MAIN}px, ${ratio() * 100}%) ${size.splitterHit} minmax(${DEBUGGER_WORKSPACE_MIN_INSPECTOR}px, 1fr)`
          }}
          css={`
            display: grid;
            grid-template-columns: var(--split);
            min-height: 0;
            min-width: 0;
            height: 100%;
          `}
          ref={(element) => {
            const onPointerMove = splitPanePointerMove(
              element,
              ratio,
              DEBUGGER_WORKSPACE_MIN_MAIN,
              DEBUGGER_WORKSPACE_MIN_INSPECTOR,
            )
            element.addEventListener('pointermove', onPointerMove)
            return () =>
              element.removeEventListener('pointermove', onPointerMove)
          }}
        >
          <div
            data-pane="left"
            css={`
              min-width: 0;
              min-height: 0;
              overflow: hidden;
            `}
          >
            <main
              css={`
                height: 100%;
                min-width: 0;
                min-height: 0;
                overflow: hidden;
              `}
            >
              {main}
            </main>
          </div>
          <button
            type="button"
            role="separator"
            aria-label="Resize panes"
            aria-orientation="vertical"
            aria-valuemin="20"
            aria-valuemax="80"
            aria-hidden={() => (placement() === 'side' ? undefined : 'true')}
            aria-valuenow={() => String(Math.round(ratio() * 100))}
            css={`
              ${focusVisible}
              appearance: none;
              border: 0;
              padding: 0;
              width: 100%;
              background: transparent;
              cursor: col-resize;
              touch-action: none;
              position: relative;
              &[aria-hidden='true'] {
                display: none;
              }
              &::before {
                content: '';
                position: absolute;
                inset-block: 0;
                inset-inline-start: 50%;
                width: 1px;
                background: ${tokens.border1};
              }
              &::after {
                content: '';
                position: absolute;
                inset-block-start: 50%;
                inset-inline-start: 50%;
                width: 4px;
                height: 18px;
                transform: translate(-50%, -50%);
                border-radius: 999px;
                background: ${tokens.border2};
              }
            `}
            on:pointerdown={(event: Event) => {
              const pointerEvent = event instanceof PointerEvent ? event : null
              if (!pointerEvent) return
              const pane = event.currentTarget
              if (pane instanceof Element && pane.parentElement) {
                pane.parentElement.setPointerCapture(pointerEvent.pointerId)
              }
            }}
            on:dblclick={() => ratio.set(DEBUGGER_WORKSPACE_DEFAULT_RATIO)}
            on:keydown={(event: KeyboardEvent) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault()
                ratio.set(Math.max(0.2, ratio() - 0.04))
                return
              }
              if (event.key === 'ArrowRight') {
                event.preventDefault()
                ratio.set(Math.min(0.8, ratio() + 0.04))
              }
            }}
          />
          <aside
            aria-label={readLabel}
            aria-hidden={() => (placement() === 'side' ? undefined : 'true')}
            css={`
              height: 100%;
              min-width: 0;
              min-height: 0;
              overflow: hidden;
              &[aria-hidden='true'] {
                display: none;
              }
            `}
          >
            {() => (placement() === 'side' && inspector ? inspector() : null)}
          </aside>
        </div>
        {() => {
          if (placement() !== 'drawer' || !inspector) return null
          return (
            <Drawer
              open={inspectorOpen}
              label={readLabel}
              onClose={onInspectorClose}
            >
              {inspector()}
            </Drawer>
          )
        }}
      </div>
      <div
        css={`
          min-width: 0;
        `}
      >
        {status}
      </div>
    </div>
  )
}
