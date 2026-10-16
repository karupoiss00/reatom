import type { Admin } from '../../index'
import {
  Button,
  Icon,
  StatusDot,
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
  ToolbarSpacer,
  radius,
  tokens,
  type,
} from '../design-system'
import { SessionControls } from './SessionControls'

export interface HeaderBarProps {
  admin: Admin
  onMinimize?: () => void
}

export const HeaderBar = ({ admin, onMinimize }: HeaderBarProps) => {
  const source = () => admin.store.source()
  const summary = () => admin.view.summary()

  return (
    <header data-reatom-name="HeaderBar">
      <Toolbar>
        <ToolbarGroup>
          <span
            aria-hidden="true"
            css={`
              ${type.ui}
              width: 20px;
              height: 20px;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              border-radius: ${radius[4]};
              background: ${tokens.canvas};
              border: 1px solid ${tokens.border2};
              color: ${tokens.text1};
              font-weight: 750;
            `}
          >
            R
          </span>
          <span
            css={`
              ${type.ui}
              color: ${tokens.text1};
              white-space: nowrap;
            `}
          >
            Reatom Admin
          </span>
          <StatusDot
            tone={() => (source() === 'replay' ? 'warning' : 'success')}
            label={() => (source() === 'replay' ? 'Replay' : 'Live')}
          />
          <span
            data-testid="summary-metrics"
            css={`
              ${type.meta}
              color: ${tokens.text2};
              font-variant-numeric: tabular-nums;
              white-space: nowrap;
              display: inline-flex;
              align-items: center;
              gap: var(--admin-space-8);
            `}
          >
            <span>
              {() => `${summary().totalFrames.toLocaleString()} frames`}
            </span>
            <StatusDot
              tone={() => (summary().errorFrames > 0 ? 'error' : 'info')}
              label={() => `${summary().errorFrames} errors`}
            />
          </span>
        </ToolbarGroup>
        <ToolbarSpacer />
        <SessionControls admin={admin} />
        {onMinimize ? (
          <>
            <ToolbarSeparator />
            <Button
              variant="icon"
              label="Minimize devtools"
              onClick={onMinimize}
            >
              <Icon name="minimize" />
            </Button>
          </>
        ) : null}
      </Toolbar>
    </header>
  )
}
