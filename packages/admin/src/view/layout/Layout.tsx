import type { Computed, RouteChild } from '@reatom/core'

import type { Admin } from '../../index'
import { FilterBar } from '../components/FilterBar'
import { HeaderBar } from '../components/HeaderBar'
import { StatusBar, StatusDot } from '../design-system'
import { adminThemeVars, tokens } from '../design-system/tokens'
import { adminSettings, bindAdminPalette } from '../settings'
import { WorkspaceTabs } from './WorkspaceTabs'

export interface LayoutProps {
  admin: Admin
  outlet: Computed<RouteChild[]>
  onMinimize?: () => void
}

export const Layout = ({ admin, outlet, onMinimize }: LayoutProps) => {
  const summary = () => admin.view.summary()
  const settings = adminSettings()

  return (
    <div
      data-admin-scheme={() => settings.resolvedScheme()}
      ref={(shell) => bindAdminPalette(shell)}
      css={`
        ${adminThemeVars}
        display: grid;
        grid-template-rows: auto auto auto minmax(0, 1fr) auto;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        background: ${tokens.canvas};
        color: ${tokens.text1};
        font-family: ${tokens.fontUi};
      `}
    >
      <HeaderBar admin={admin} onMinimize={onMinimize} />
      <WorkspaceTabs />
      <FilterBar admin={admin} />
      <main
        css={`
          min-height: 0;
          min-width: 0;
          overflow: hidden;
        `}
      >
        {outlet}
      </main>
      <StatusBar>
        {() => {
          const current = summary()
          const paused = admin.reporter.paused()
          const following = admin.view.followLive()
          return (
            <span
              css={`
                display: contents;
              `}
            >
              <StatusDot
                tone={
                  current.source === 'replay'
                    ? 'warning'
                    : paused
                      ? 'warning'
                      : 'success'
                }
                label={
                  current.source === 'replay'
                    ? 'Replay'
                    : paused
                      ? 'Paused'
                      : 'Capturing'
                }
              />
              <span>
                {current.visibleFrames} / {current.totalFrames} visible
              </span>
              <span>{admin.filters.engine.configs().length} rules</span>
              <span>{following ? 'Follow on' : 'Follow paused'}</span>
              <span
                css={`
                  margin-inline-start: auto;
                `}
              >
                J/K navigate · / find
              </span>
            </span>
          )
        }}
      </StatusBar>
    </div>
  )
}
