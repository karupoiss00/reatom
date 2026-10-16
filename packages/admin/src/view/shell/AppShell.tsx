import type { Admin } from '../../index'
import { adminThemeVars, tokens } from '../design-system'
import { createAdminRoutes } from '../routes'
import { adminSettings, bindAdminPalette } from '../settings'
import { adminShellContainer } from '../styles'

export interface AppShellProps {
  admin: Admin
  onMinimize?: () => void
}

export const AppShell = ({ admin, onMinimize }: AppShellProps) => {
  const routes = createAdminRoutes(admin, { onMinimize })
  const settings = adminSettings()

  return (
    <div
      data-reatom-name="AppShell"
      data-testid="admin-visual-snapshot"
      data-admin-scheme={() => settings.resolvedScheme()}
      ref={(shell) => bindAdminPalette(shell)}
      css={`
        ${adminThemeVars}
        ${adminShellContainer}
        height: 100%;
        min-height: 0;
        overflow: hidden;
        background: ${tokens.canvas};
        color: ${tokens.text1};
        font-family: ${tokens.fontUi};
      `}
    >
      {routes.layoutRoute.render}
    </div>
  )
}
