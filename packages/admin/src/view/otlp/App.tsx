import {
  addChangeHook,
  atom,
  effect,
  sleep,
  wrap,
  type Atom,
} from '@reatom/core'
import { mount } from '@reatom/jsx'

import type { AdminConnection, OtlpAdmin, OtlpAdminOptions } from '../../otlp'
import {
  ADMIN_CLEAR_UNDO_MS,
  attentionItems,
  freshnessLabel,
  reatomOtlpAdmin,
} from '../../otlp'
import { ADMIN_FRAME } from '../../root'
import {
  Button,
  DebuggerWorkspace,
  Drawer,
  Kbd,
  Popover,
  StatusBar,
  StatusDot,
  Tabs,
  Toast,
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
  ToolbarSpacer,
  capturingPulse,
  focusVisible,
  scrollable,
  size,
  tokens,
  truncate,
  type,
} from '../design-system'
import { adminThemeVars } from '../design-system/tokens'
import { ADMIN_HOST_Z_INDEX, keepAdminHostInView } from '../hostBox'
import { bindAdminStylesheet } from '../stylesheet'
import { AgentCallLog } from '../../mcp/AgentCallLog'
import { mcpCallLog } from '../../mcp/callLog'
import { adminSettings, bindAdminPalette } from '../settings'
import { OtlpAnalyticsScreen, analystStatusWords } from './AnalyticsScreen'
import { ExclusionBanner } from './ExclusionBanner'
import { closeFrameCard, OtlpFrameCard } from './FrameCard'
import { OtlpFilterBar } from './FilterBar'
import { ImportRecords } from './ImportRecords'
import { floatAdminHost, type FloatingWindowOptions } from './FloatingWindow'
import { OtlpGanttChart, pathRowAdapter, recordRowAdapter } from './GanttChart'
import { PathStepCard } from './PathStepCard'
import { PathsFunnelView, PathsPresentationBar } from './PathsFunnel'
import { OtlpRemotePanel } from './RemotePanel'
import { OtlpGraphView, OtlpStateView } from './SecondaryViews'
import { handleAdminShellKey, isEditableTarget } from './shellKeys'
import { SettingsScreen } from './SettingsScreen'

export interface OtlpAppProps {
  admin: OtlpAdmin
  connection?: AdminConnection | null
  /** Shared with the floating window so Minimize also shrinks the host. */
  minimized?: Atom<boolean>
  /** Shared with the floating window so Close shrinks the host to an icon. */
  closed?: Atom<boolean>
  /**
   * The host is already docked, so the closed icon fills it instead of using
   * `position: fixed`.
   */
  floating?: boolean
}

export interface AdminViewOptions {
  /**
   * Float the host over the page as a resizable window instead of filling the
   * box the page gives it. Minimize collapses it to a status strip. Close
   * leaves an icon in the corner chosen in Settings.
   */
  floating?: boolean | FloatingWindowOptions
}

let shellCounter = 0

const VIEWS = [
  { id: 'timeline' as const, label: 'Timeline' },
  { id: 'state' as const, label: 'State' },
  { id: 'graph' as const, label: 'Graph' },
  { id: 'analytics' as const, label: 'Analytics' },
  { id: 'settings' as const, label: 'Settings' },
]

function isCapturing(
  admin: OtlpAdmin,
  connection: AdminConnection | null,
): boolean {
  if (admin.source() === 'remote' || admin.source() === 'replay') return false
  return !(connection ? connection.paused() : admin.paused())
}

function currentFreshness(
  admin: OtlpAdmin,
  connection: AdminConnection | null,
  now: number,
): string {
  return freshnessLabel({
    source: admin.source(),
    paused: connection ? connection.paused() : admin.paused(),
    waiting: connection?.waiting() ?? 0,
    now,
    records: admin.records(),
  })
}

function serviceLabel(admin: OtlpAdmin): string {
  const name = admin.records()[0]?.resource['service.name']
  if (typeof name === 'string' && name !== '') return name
  if (admin.source() === 'remote') return 'ClickHouse'
  if (admin.source() === 'replay') return 'Replay'
  return 'Live'
}

export const OtlpApp = ({
  admin,
  connection = null,
  minimized: sharedMinimized,
  closed: sharedClosed,
  floating = false,
}: OtlpAppProps) => {
  const shellId = ++shellCounter
  const settings = adminSettings()
  const helpOpen = atom(false, `_Admin.shell.help.${shellId}`)
  const frameCardOpen = atom(false, `_Admin.shell.frameCard.${shellId}`)
  effect(() => {
    frameCardOpen.set(admin.view() !== 'settings' && admin.cardOpen())
  }, `_Admin.shell.frameCard.sync.${shellId}`)
  const undoOpen = atom(false, `_Admin.shell.undoOpen.${shellId}`)
  const undoGeneration = atom(0, `_Admin.shell.undoGeneration.${shellId}`)
  const freshnessNow = atom(Date.now(), `_Admin.shell.freshness.${shellId}`)
  effect(async () => {
    while (true) {
      freshnessNow.set(Date.now())
      await wrap(sleep(1000))
    }
  }, `_Admin.shell.freshnessTick.${shellId}`)
  const minimized =
    sharedMinimized ?? atom(false, `_Admin.shell.minimized.${shellId}`)
  const closed = sharedClosed ?? atom(false, `_Admin.shell.closed.${shellId}`)
  const launcherEdge = (side: 'top' | 'right' | 'bottom' | 'left') => () => {
    if (floating) return '0px'
    const corner = settings.corner()
    const placed =
      (side === 'top' && corner.startsWith('top')) ||
      (side === 'bottom' && corner.startsWith('bottom')) ||
      (side === 'left' && corner.endsWith('left')) ||
      (side === 'right' && corner.endsWith('right'))
    return placed ? '16px' : 'auto'
  }
  const openPanel = () => {
    minimized.set(false)
    closed.set(false)
  }
  let localSnapshot: ReturnType<OtlpAdmin['records']> | null = null

  effect(async () => {
    if (admin.inProgress().length === 0) return
    while (admin.inProgress().length > 0) {
      admin.ganttNow.set(Date.now())
      await wrap(sleep(200))
    }
  }, `_Admin.shell.tickNow.${shellId}`)

  const clearWorkspace = () => {
    undoGeneration.set(undoGeneration() + 1)
    if (connection) connection.clear()
    else {
      localSnapshot = admin.records().slice()
      admin.clear()
    }
    undoOpen.set(true)
  }

  const restoreWorkspace = () => {
    if (connection) connection.undo()
    else if (localSnapshot) admin.restoreRecords(localSnapshot)
    localSnapshot = null
  }

  const togglePause = () => {
    if (connection) {
      if (connection.paused()) connection.resume()
      else connection.pause()
      return
    }
    if (admin.paused()) admin.paused.setFalse()
    else admin.paused.setTrue()
  }

  const header = (
    <header>
      <Toolbar height={size.tabs}>
        <ToolbarGroup>
          <span
            css={`
              ${type.ui}
              color: ${tokens.text1};
              white-space: nowrap;
              flex: none;
            `}
          >
            Reatom Admin
          </span>
          <span
            css={`
              ${type.meta}
              flex: none;
              white-space: nowrap;
            `}
          >
            <StatusDot
              tone={() =>
                isCapturing(admin, connection) ? 'accent' : 'warning'
              }
              pulse={() => isCapturing(admin, connection)}
              label={() =>
                currentFreshness(admin, connection, freshnessNow())
              }
            />
          </span>
          <span
            css={`
              ${type.meta}
              ${truncate}
              min-width: 0;
              color: ${tokens.text2};
            `}
          >
            {() => serviceLabel(admin)}
          </span>
          <span
            data-testid="summary-metrics"
            css={`
              ${type.meta}
              ${truncate}
              min-width: 0;
              color: ${tokens.text2};
              font-variant-numeric: tabular-nums;
            `}
          >
            {() => `${admin.summary().totalFrames.toLocaleString()} records`}
          </span>
        </ToolbarGroup>
        <ToolbarSpacer />
        <div
          css={`
            flex: none;
            display: flex;
          `}
        >
          <Tabs value={admin.view} items={VIEWS} ariaLabel="Views" />
        </div>
      </Toolbar>
      <div
        css={`
          ${scrollable}
          overflow-y: hidden;
          background: ${tokens.surface1};
        `}
      >
        <div
          css={`
            width: max-content;
            min-width: 100%;
          `}
        >
          <Toolbar>
            <ToolbarGroup>
              <Button
                label="Back"
                title="Back (Alt+Left)"
                disabled={() => !admin.canSelectionBack()}
                onClick={() => admin.selectionBack()}
              >
                Back
              </Button>
              <Button
                label="Forward"
                title="Forward (Alt+Right)"
                disabled={() => !admin.canSelectionForward()}
                onClick={() => admin.selectionForward()}
              >
                Forward
              </Button>
              <span
                css={`
                  display: inline-flex;
                  align-items: center;
                  gap: var(--admin-space-6);
                `}
              >
                {() =>
                  (connection ? connection.paused() : admin.paused()) ? (
                    <Button
                      label="Resume"
                      disabled={() => admin.source() === 'remote'}
                      title={() =>
                        admin.source() === 'remote'
                          ? 'Pause is for live capture, not ClickHouse'
                          : 'Resume live capture'
                      }
                      onClick={togglePause}
                    >
                      Resume
                    </Button>
                  ) : (
                    <Button
                      label="Pause"
                      disabled={() => admin.source() === 'remote'}
                      title={() =>
                        admin.source() === 'remote'
                          ? 'Pause is for live capture, not ClickHouse'
                          : 'Pause live capture'
                      }
                      onClick={togglePause}
                    >
                      Pause
                    </Button>
                  )
                }
                {() =>
                  admin.source() === 'remote' ? (
                    <span
                      css={`
                        ${type.meta}
                        color: ${tokens.text3};
                      `}
                    >
                      Pause is for live capture
                    </span>
                  ) : null
                }
              </span>
            </ToolbarGroup>
            <ToolbarSeparator />
            <ToolbarGroup>
              <Button variant="danger" label="Clear" onClick={clearWorkspace}>
                Clear
              </Button>
              <Button
                label="Export"
                onClick={() => downloadRecords(admin.records())}
              >
                Export
              </Button>
              <ImportRecords admin={admin} />
              <Button
                label="Remote ClickHouse source"
                testId="otlp-remote-toggle"
                pressed={() => admin.remoteOpen()}
                onClick={() => admin.remoteOpen.toggle()}
              >
                ClickHouse
              </Button>
            </ToolbarGroup>
            <ToolbarSpacer />
            <ToolbarGroup>
              <Button
                label="Help"
                title="Help (?)"
                onClick={() => helpOpen.set(true)}
              >
                Help
              </Button>
              <Button
                label="Close"
                onClick={() => {
                  minimized.set(false)
                  closed.set(true)
                }}
              >
                Close
              </Button>
              <Button label="Minimize" onClick={() => minimized.set(true)}>
                Minimize
              </Button>
            </ToolbarGroup>
          </Toolbar>
        </div>
      </div>
    </header>
  )

  const filters = (
    <div>
      {() =>
        admin.view() === 'settings' ? null : (
          <div>
            {() =>
              admin.remoteOpen() ? <OtlpRemotePanel admin={admin} /> : null
            }
            <OtlpFilterBar admin={admin} />
            <ExclusionBanner admin={admin} />
          </div>
        )
      }
    </div>
  )

  const main = (
    <div
      css={`
        height: 100%;
        min-height: 0;
        min-width: 0;
      `}
    >
      {() => {
        const view = admin.view()
        if (view === 'settings') return <SettingsScreen />
        if (view === 'state') return <OtlpStateView admin={admin} />
        if (view === 'graph') return <OtlpGraphView admin={admin} />
        if (view === 'analytics') return <OtlpAnalyticsScreen admin={admin} />
        if (admin.timelineUnit() === 'paths') {
          return (
            <div
              css={`
                display: grid;
                grid-template-rows: auto minmax(0, 1fr);
                height: 100%;
                min-height: 0;
              `}
            >
              <PathsPresentationBar admin={admin} />
              {() =>
                admin.analytics.pathsPresentation() === 'funnel' ? (
                  <PathsFunnelView admin={admin} />
                ) : (
                  <OtlpGanttChart
                    gantt={admin.analytics.paths}
                    admin={admin}
                    connection={connection}
                    adapter={pathRowAdapter(admin)}
                    onInspect={() => admin.cardOpen.setTrue()}
                  />
                )
              }
            </div>
          )
        }
        return (
          <OtlpGanttChart
            gantt={admin.gantt}
            admin={admin}
            connection={connection}
            adapter={recordRowAdapter(admin, admin.ganttSelection, connection)}
            onInspect={() => admin.cardOpen.setTrue()}
          />
        )
      }}
    </div>
  )

  const status = (
    <StatusBar>
      <span role="status">
        {() => currentFreshness(admin, connection, freshnessNow())}
      </span>
      <span>
        {() => {
          const analyst =
            admin.view() === 'analytics' ||
            (admin.view() === 'timeline' && admin.timelineUnit() === 'paths')
          if (analyst) return analystStatusWords(admin)
          const summary = admin.summary()
          return `${summary.visibleFrames} of ${summary.totalFrames}`
        }}
      </span>
      {() => {
        const errors = admin.errorCount()
        if (errors === 0) return null
        return (
          <Button
            variant="ghost"
            label={`Errors ${errors}`}
            onClick={() => {
              admin.view.set('timeline')
              admin.filterHasError.set(true)
            }}
          >
            {`Errors ${errors}`}
          </Button>
        )
      }}
      {() => {
        const openCount = admin.inProgress().length
        if (openCount === 0) return null
        return <span>{`Open ${openCount}`}</span>
      }}
      {() => {
        const hidden =
          admin.hiddenAbortSuspenseCount() + admin.hiddenMountLogCount()
        if (hidden === 0) return null
        return (
          <Button
            variant="ghost"
            label={`Hidden ${hidden}`}
            onClick={() => {
              admin.showAbortAndSuspense.setTrue()
              admin.showMountLogs.setTrue()
            }}
          >
            {`Hidden ${hidden}`}
          </Button>
        )
      }}
      {() => {
        const dropped = connection?.stats()?.dropped ?? 0
        if (dropped === 0) return null
        return <span>{`Dropped ${dropped}`}</span>
      }}
      {() => {
        const stats = connection?.stats()
        if (!stats) return null
        const parts: string[] = []
        if (stats.queued > 0) parts.push(`queued ${stats.queued}`)
        if (stats.inFlight > 0) parts.push(`in flight ${stats.inFlight}`)
        if (stats.exported > 0) parts.push(`exported ${stats.exported}`)
        if (parts.length === 0) return null
        return parts.join(' · ')
      }}
      {() =>
        admin.localValuesTrimmed() ? (
          <span>Live values trimmed to the store cap</span>
        ) : null
      }
      {() =>
        admin.inProgress().length > 0 ? (
          <span>Hatched bars are still in progress</span>
        ) : null
      }
      {() => {
        const sessions = admin.analytics.sessions().length
        return admin.view() === 'analytics' && sessions > 0 && sessions < 5 ? (
          <span>Shares hide below 5 sessions</span>
        ) : null
      }}
      {() => {
        const items = attentionItems({
          olderRecordsDropped: connection?.olderRecordsDropped() ?? false,
          localValuesTrimmed: admin.localValuesTrimmed(),
          transportQuarantined:
            connection?.stats()?.transportQuarantined ?? false,
          inProgressCount: admin.inProgress().length,
          analyticsSessions: admin.analytics.sessions().length,
        })
        if (items.length === 0) return null
        return (
          <Popover triggerLabel="Needs attention" label="Needs attention">
            <div
              css={`
                display: grid;
                gap: var(--admin-space-8);
                min-width: 14rem;
              `}
            >
              {items.map((item) => (
                <div
                  css={`
                    display: grid;
                    gap: var(--admin-space-2);
                  `}
                >
                  <span css={`${type.ui} color: ${tokens.text1};`}>
                    {item.text}
                  </span>
                  <span css={`${type.meta} color: ${tokens.text3};`}>
                    {item.next}
                  </span>
                </div>
              ))}
            </div>
          </Popover>
        )
      }}
      {() => {
        const reasons = connection?.stats()?.droppedByReason ?? {}
        const entries = Object.entries(reasons)
        if (entries.length === 0) return null
        return (
          <Popover triggerLabel="Drop reasons" label="Dropped by reason">
            <span>
              {entries
                .map(([reason, count]) => `${reason}: ${count}`)
                .join(', ')}
            </span>
          </Popover>
        )
      }}
      {() =>
        settings.agentCallLog() ? (
          <span data-testid="agent-read-chip">
            {() => {
              const count = mcpCallLog().lastReadCount()
              return count > 0 ? `Agent read ${count} records` : null
            }}
          </span>
        ) : null
      }
      {() => (settings.agentCallLog() ? <AgentCallLog admin={admin} /> : null)}
    </StatusBar>
  )

  return (
    <div
      data-reatom-name="AppShell"
      data-testid="admin-visual-snapshot"
      data-admin-icons={() => String(settings.icons())}
      data-admin-colors={() => String(settings.colors())}
      data-admin-scheme={() => settings.resolvedScheme()}
      data-admin-corner={() => settings.corner()}
      data-closed={() => (closed() ? 'true' : 'false')}
      tabindex={0}
      css={`
        ${adminThemeVars}
        position: relative;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        background: ${tokens.canvas};
        color: ${tokens.text1};
        font-family: ${tokens.fontUi};
        outline: none;
        &:has([data-reatom-name='SettingsScreen']) [aria-label='Filters'] {
          display: none;
        }
        &[data-closed='true'] {
          background: transparent;
          pointer-events: none;
          overflow: visible;
        }
      `}
      ref={(shell) => {
        const onCapture = wrap((event: Event) => {
          if (!(event instanceof KeyboardEvent)) return
          if (event.key !== 'Escape' || isEditableTarget(event.target)) return
          if (!helpOpen()) return
          event.preventDefault()
          event.stopPropagation()
          helpOpen.set(false)
        })
        const onBubble = wrap((event: Event) => {
          if (!(event instanceof KeyboardEvent)) return
          handleAdminShellKey(shell, event, admin, helpOpen)
        })
        shell.addEventListener('keydown', onCapture, true)
        shell.addEventListener('keydown', onBubble)
        connection?.refreshStats()
        const unbindPalette = bindAdminPalette(shell)
        return () => {
          unbindPalette()
          shell.removeEventListener('keydown', onCapture, true)
          shell.removeEventListener('keydown', onBubble)
        }
      }}
    >
      {() =>
        closed() ? (
          <button
            type="button"
            aria-label="Open Reatom Admin"
            data-capturing={() =>
              isCapturing(admin, connection) ? 'true' : 'false'
            }
            data-errors={() => (admin.errorCount() > 0 ? 'true' : 'false')}
            css:openPosition={() => (floating ? 'absolute' : 'fixed')}
            css:openTop={launcherEdge('top')}
            css:openRight={launcherEdge('right')}
            css:openBottom={launcherEdge('bottom')}
            css:openLeft={launcherEdge('left')}
            css:openWidth={() => (floating ? '100%' : '44px')}
            css:openHeight={() => (floating ? '100%' : '44px')}
            css={`
              all: unset;
              box-sizing: border-box;
              position: var(--openPosition);
              top: var(--openTop);
              right: var(--openRight);
              bottom: var(--openBottom);
              left: var(--openLeft);
              z-index: ${ADMIN_HOST_Z_INDEX};
              width: var(--openWidth);
              height: var(--openHeight);
              display: inline-flex;
              align-items: center;
              justify-content: center;
              border-radius: 999px;
              border: 1px solid ${tokens.border2};
              background: ${tokens.surface2};
              color: ${tokens.accent};
              font-family: ${tokens.fontUi};
              font-size: 1rem;
              font-weight: 750;
              cursor: pointer;
              pointer-events: auto;
              box-shadow: 0 12px 28px -16px ${tokens.shadowStrong};
              ${focusVisible}
              &[data-capturing='true'] {
                ${capturingPulse}
              }
              &[data-errors='true']::after {
                content: '';
                position: absolute;
                top: 4px;
                right: 4px;
                width: 8px;
                height: 8px;
                border-radius: 999px;
                background: ${tokens.error};
              }
            `}
            on:click={() => {
              openPanel()
              if (admin.errorCount() > 0) {
                admin.view.set('timeline')
                admin.filterHasError.set(true)
              }
            }}
          >
            R
          </button>
        ) : minimized() ? (
          <Toolbar>
            <ToolbarGroup>
              <span role="status">
                {() => currentFreshness(admin, connection, freshnessNow())}
              </span>
              {() =>
                admin.errorCount() > 0 ? (
                  <span
                    aria-label="Errors in capture"
                    css={`
                      width: 8px;
                      height: 8px;
                      border-radius: 999px;
                      background: ${tokens.error};
                    `}
                  />
                ) : null
              }
            </ToolbarGroup>
            <ToolbarSpacer />
            <Button
              label="Show admin"
              onClick={() => {
                minimized.set(false)
                if (admin.errorCount() > 0) {
                  admin.view.set('timeline')
                  admin.filterHasError.set(true)
                }
              }}
            >
              Show
            </Button>
          </Toolbar>
        ) : null
      }
      <div
        prop:hidden={() => minimized() || closed()}
        css={`
          height: 100%;
          min-height: 0;
        `}
      >
        <DebuggerWorkspace
          header={header}
          filter={filters}
          main={main}
          inspector={() => <OtlpInspectorBody admin={admin} />}
          inspectorLabel={() =>
            admin.view() === 'timeline' && admin.timelineUnit() === 'paths'
              ? 'Step'
              : 'Frame'
          }
          inspectorOpen={frameCardOpen}
          onInspectorClose={() => closeFrameCard(admin)}
          status={status}
        />
      </div>
      {() => {
        undoGeneration()
        if (!undoOpen()) return null
        return (
          <Toast
            open={undoOpen}
            message="Records cleared"
            actionLabel="Undo"
            onAction={restoreWorkspace}
            onDismiss={() => {
              localSnapshot = null
            }}
            durationMs={ADMIN_CLEAR_UNDO_MS}
          />
        )
      }}
      <Drawer open={helpOpen} label="Help" onClose={() => helpOpen.set(false)}>
        <HelpBody />
      </Drawer>
    </div>
  )
}

const OtlpInspectorBody = ({ admin }: { admin: OtlpAdmin }) => (
  <div css="display: contents;">
    {() =>
      admin.view() === 'timeline' && admin.timelineUnit() === 'paths' ? (
        <PathStepCard admin={admin} />
      ) : (
        <OtlpFrameCard admin={admin} />
      )
    }
  </div>
)

const HelpBody = () => (
  <div
    css={`
      display: grid;
      gap: var(--admin-space-8);
      ${type.body}
    `}
  >
    <p css="margin: 0;">Shortcuts</p>
    <p css="margin: 0;">
      <Kbd keys={['J']} /> <Kbd keys={['K']} /> move the selection. Arrow keys
      do the same. Left and Right collapse and expand. Enter opens the frame
      card. Esc closes the top layer. <Kbd keys={['/']} /> focuses name search.{' '}
      <Kbd keys={['?']} /> opens this help. <Kbd keys={['Alt', 'Left']} /> and{' '}
      <Kbd keys={['Alt', 'Right']} /> walk selection history.{' '}
      <Kbd keys={['I']} /> toggles kind icons. <Kbd keys={['C']} /> toggles kind
      colors.
    </p>
    <p css="margin: 0;">
      Filter language: name, kind, errors, error.type, error.message, duration,
      spans, trace, attr, cause and the direction markers. Example:
      name:makeMove kind:action. Exception type: error.type:TypeError.
    </p>
    <p css="margin: 0;">
      Paths and Analytics treat the filter as a session filter (a session is in
      when any record matches; Exclude flips). Show, Hide, and Highlight do not
      apply there, and filter.mode is ignored by the analytics tools.
    </p>
  </div>
)

function downloadRecords(records: readonly unknown[]) {
  const blob = new Blob([JSON.stringify(records, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'admin-records.json'
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Inherited text styles of the host app stop at the shadow host. Inline styles
 * that a story or `keepAdminHostInView` sets on the host still win.
 */
const ADMIN_HOST_RESET = `
  :host {
    all: initial;
    display: block;
  }
  :host([hidden]) {
    display: none;
  }
`

let viewCounter = 0

/**
 * Mounts the Gantt-first admin into `host`'s shadow root and points JSX `css`
 * rules at that shadow sheet. With `floating`, the host becomes a fixed window
 * over the page. Call it inside `ADMIN_FRAME`.
 */
export function mountAdminView(
  host: HTMLElement,
  admin: OtlpAdmin,
  connection: AdminConnection | null,
  options: AdminViewOptions = {},
): () => void {
  host.dataset['adminHost'] = ''
  host.hidden = false
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  shadow.replaceChildren()
  const hostReset = document.createElement('style')
  hostReset.textContent = ADMIN_HOST_RESET
  shadow.append(hostReset)
  const adminSheet = bindAdminStylesheet(shadow)
  const { floating = false } = options
  const floatingOptions = floating === true ? {} : floating || null
  const viewId = ++viewCounter
  const minimized = atom(false, `_Admin.view.minimized.${viewId}`)
  const closed = atom(false, `_Admin.view.closed.${viewId}`)
  const releaseHostBox = floatingOptions
    ? floatAdminHost(host, shadow, minimized, closed, floatingOptions)
    : keepAdminHostInView(host)
  const syncClosedPointer = (value: boolean) => {
    if (floatingOptions) return
    host.style.pointerEvents = value ? 'none' : ''
  }
  syncClosedPointer(closed())
  const removeClosedPointer = addChangeHook(closed, syncClosedPointer)
  const mountHost = document.createElement('div')
  mountHost.style.height = '100%'
  mountHost.style.minHeight = '0'
  shadow.append(mountHost)
  const mountPoint = document.createElement('div')
  mountPoint.style.height = '100%'
  mountPoint.style.minHeight = '0'
  mountHost.append(mountPoint)
  const app = (
    <OtlpApp
      admin={admin}
      connection={connection}
      minimized={minimized}
      closed={closed}
      floating={floatingOptions !== null}
    />
  )
  const mounted = mount(mountPoint, app)
  return () => {
    mounted.unmount()
    removeClosedPointer()
    if (!floatingOptions) host.style.pointerEvents = ''
    releaseHostBox()
    adminSheet.restore()
  }
}

export function createOtlpAdminApp(
  target: Element,
  options: OtlpAdminOptions,
  records: readonly unknown[] = [],
  viewOptions: AdminViewOptions = {},
): { admin: OtlpAdmin; unmount: () => void } {
  const admin = reatomOtlpAdmin(options)
  const host =
    target instanceof HTMLElement ? target : document.createElement('div')
  if (!(target instanceof HTMLElement)) target.append(host)
  return ADMIN_FRAME.run(() => {
    if (records.length > 0) admin.ingest(records)
    const unmount = mountAdminView(host, admin, null, viewOptions)
    return { admin, unmount }
  })
}
