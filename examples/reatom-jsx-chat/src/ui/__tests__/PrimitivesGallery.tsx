import { atom } from '@reatom/core'
import type { JSX } from '@reatom/jsx'

import { colorTokenGroups, tones } from '../../styles/tokens'
import { dialogSurfaceStyles } from '../Dialog'
import {
  AutoGrowTextarea,
  Badge,
  Banner,
  Button,
  Checkbox,
  Chip,
  Icon,
  IconButton,
  iconNames,
  InfoButton,
  lastAnnouncement,
  LiveRegion,
  Menu,
  Skeleton,
  Spinner,
  Switch,
  Tabs,
  TextField,
  Toaster,
  type ButtonVariant,
  type IconName,
} from '../index'

type ForcedState = 'hover' | 'focus' | 'active'

const forcedStates: Record<ForcedState, string> = {
  hover: 'hover',
  focus: 'focus focus-visible',
  active: 'hover active',
}

const forced = (state: ForcedState) => forcedStates[state]

const Card = ({
  title,
  note,
  span = 6,
  gallery,
  children,
}: {
  title: string
  note?: string
  span?: number
  gallery?: string
  children: JSX.ElementChildren
}) => (
  <section
    data-gallery={gallery ?? null}
    css:span={String(span)}
    css={`
      grid-column: span var(--span);
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      min-width: 0;
      padding: var(--space-5);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--bg-elevated);
      box-shadow: var(--shadow-1);

      & > header {
        display: grid;
        gap: var(--space-1);
      }

      & > header h2 {
        margin: 0;
        color: var(--text-muted);
        font-size: var(--text-2xs);
        font-weight: var(--weight-semibold);
        letter-spacing: var(--tracking-caps);
        text-transform: uppercase;
      }

      & > header p {
        margin: 0;
        color: var(--text-muted);
        font-size: var(--text-sm);
      }
    `}
  >
    <header>
      <h2>{title}</h2>
      {note ? <p>{note}</p> : null}
    </header>
    {children}
  </section>
)

const StateLabel = ({ children }: { children: string }) => (
  <span
    css={`
      color: var(--text-faint);
      font-size: var(--text-2xs);
      font-weight: var(--weight-medium);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    `}
  >
    {children}
  </span>
)

const stateColumns = [
  'Default',
  'Hover',
  'Focus',
  'Pressed',
  'Disabled',
  'Loading',
] as const

const matrixStyles = `
  display: grid;
  grid-template-columns: 6rem repeat(6, minmax(0, 1fr));
  align-items: center;
  justify-items: start;
  gap: var(--space-2) var(--space-3);

  & > [data-row-label] {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
`

const variantLabels: Record<ButtonVariant, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  ghost: 'Ghost',
  soft: 'Soft',
  danger: 'Danger',
}

const variantCopy: Record<ButtonVariant, string> = {
  primary: 'Send',
  secondary: 'Export',
  ghost: 'Cancel',
  soft: 'Connect',
  danger: 'Delete all',
}

const StateHeader = () => [
  <span />,
  ...stateColumns.map((column) => <StateLabel>{column}</StateLabel>),
]

const ButtonStates = ({
  variant,
  size = 'md',
  icon,
  label,
}: {
  variant: ButtonVariant
  size?: 'md' | 'sm'
  icon?: IconName
  label: string
}) => [
  <Button variant={variant} size={size} icon={icon} data-gallery-state="default">
    {label}
  </Button>,
  <Button variant={variant} size={size} icon={icon} data-gallery-state="hover" data-gallery-force={forced('hover')}>
    {label}
  </Button>,
  <Button variant={variant} size={size} icon={icon} data-gallery-state="focus" data-gallery-force={forced('focus')}>
    {label}
  </Button>,
  <Button variant={variant} size={size} icon={icon} data-gallery-state="active" data-gallery-force={forced('active')}>
    {label}
  </Button>,
  <Button variant={variant} size={size} icon={icon} data-gallery-state="disabled" disabled>
    {label}
  </Button>,
  <Button variant={variant} size={size} icon={icon} data-gallery-state="loading" loading>
    {label}
  </Button>,
]

const ButtonMatrix = () => (
  <div css={matrixStyles}>
    {StateHeader()}
    {(Object.keys(variantLabels) as ButtonVariant[]).map((variant) => [
      <span data-row-label="">{variantLabels[variant]}</span>,
      ...ButtonStates({ variant, label: variantCopy[variant] }),
    ])}
    <span data-row-label="">Compact</span>
    {ButtonStates({ variant: 'secondary', size: 'sm', icon: 'plus', label: 'New chat' })}
    <span data-row-label="">Compact soft</span>
    {ButtonStates({ variant: 'soft', size: 'sm', icon: 'copy', label: 'Copy' })}
  </div>
)

const IconButtonStates = ({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  toggle = false,
}: {
  icon: IconName
  label: string
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  toggle?: boolean
}) => [
  <IconButton icon={icon} label={label} variant={variant} size={size} pressed={toggle ? false : undefined} />,
  <IconButton icon={icon} label={label} variant={variant} size={size} pressed={toggle ? false : undefined} data-gallery-force={forced('hover')} />,
  <IconButton icon={icon} label={label} variant={variant} size={size} pressed={toggle ? false : undefined} data-gallery-force={forced('focus')} />,
  toggle ? (
    <IconButton icon={icon} label={label} variant={variant} size={size} pressed />
  ) : (
    <IconButton icon={icon} label={label} variant={variant} size={size} data-gallery-force={forced('active')} />
  ),
  <IconButton icon={icon} label={label} variant={variant} size={size} disabled />,
  <IconButton icon={icon} label={label} variant={variant} size={size} loading />,
]

const IconButtonRow = () => (
  <div css={matrixStyles}>
    {StateHeader()}
    <span data-row-label="">Ghost</span>
    {IconButtonStates({ icon: 'regenerate', label: 'Regenerate' })}
    <span data-row-label="">Filled</span>
    {IconButtonStates({ icon: 'send', label: 'Send', variant: 'primary' })}
    <span data-row-label="">Toggle</span>
    {IconButtonStates({ icon: 'sidebar', label: 'Sidebar', toggle: true })}
    <span data-row-label="">Compact</span>
    {IconButtonStates({ icon: 'more', label: 'More', size: 'sm' })}
  </div>
)

const ChipRow = () => (
  <div
    css={`
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
    `}
  >
    <Chip icon="sparkle" caret>
      GPT-4o mini
    </Chip>
    <Chip icon="sparkle" caret data-gallery-force={forced('hover')}>
      Claude Sonnet 4.5
    </Chip>
    <Chip data-gallery-force={forced('focus')}>≈ 0.04¢</Chip>
    <Chip icon="globe" selected>
      Web search
    </Chip>
    <Chip icon="lock" selected={false}>
      Zero retention
    </Chip>
    <Chip icon="paperclip" disabled>
      Attach
    </Chip>
  </div>
)

const BadgeRow = () => (
  <div
    css={`
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    `}
  >
    <Badge>Free</Badge>
    <Badge tone="accent" icon="sparkle">
      Reasoning
    </Badge>
    <Badge tone="success" icon="check">
      Saved
    </Badge>
    <Badge tone="warning">128k context</Badge>
    <Badge tone="danger" icon="danger">
      Limit reached
    </Badge>
    <Badge icon="key">BYOK</Badge>
    <Badge tone="accent">$74.50 left</Badge>
  </div>
)

const BannerStack = () => (
  <div
    css={`
      display: grid;
      gap: var(--space-3);
    `}
  >
    <Banner
      tone="neutral"
      title="Read-only archive"
      onDismiss={() => {}}
    >
      Connect a key to send, regenerate, or edit.
    </Banner>
    <Banner tone="accent" title="Three new models in your catalog">
      They stay out of your short list until you pin them.
    </Banner>
    <Banner tone="success" title="Chats imported">
      42 conversations are ready in the sidebar.
    </Banner>
    <Banner
      tone="warning"
      title="You're offline"
      actions={
        <Button size="sm" variant="secondary" icon="regenerate">
          Retry now
        </Button>
      }
    >
      Your draft is kept. Sending resumes when you're back online.
    </Banner>
    <Banner
      tone="danger"
      title="Key limit reached"
      actions={[
        <Button size="sm" variant="primary">
          Raise limit
        </Button>,
        <Button size="sm" variant="ghost">
          Use another key
        </Button>,
      ]}
    >
      This key has $0.00 of its $10.00 limit remaining.
    </Banner>
  </div>
)

const FieldsGrid = () => (
  <div
    css={`
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-4) var(--space-5);
    `}
  >
    <TextField
      label="Chat title"
      placeholder="Untitled chat"
      value={atom('Trip to Lisbon', 'gallery.title')}
      hint="Shown in the sidebar and in exports."
    />
    <TextField
      label="Search chats"
      leadingIcon="search"
      placeholder="Search"
      data-gallery-force-parent="focus-within"
      value={atom('lisbon', 'gallery.search')}
    />
    <TextField
      label="API key"
      type="password"
      leadingIcon="key"
      value={atom('sk-or-v1-0000', 'gallery.key')}
      error="That key wasn't recognised. Check that you copied all of it."
    />
    <TextField
      label="Credit limit"
      value={atom('$10.00', 'gallery.limit')}
      disabled
      hint="Set on openrouter.ai."
    />
    <div css="grid-column: 1 / -1;">
      <TextField
        label="Paste a key"
        leadingIcon="key"
        placeholder="sk-or-v1-…"
        hint="Your key stays in this browser. Only openrouter.ai sees it."
        trailing={
          <Button size="sm" variant="primary">
            Connect
          </Button>
        }
      />
    </div>
    <div css="grid-column: 1 / -1;">
      <AutoGrowTextarea
        label="Message"
        placeholder="Message"
        value={atom(
          'Plan a three-day trip to Lisbon.\nKeep it walkable, with one day for Sintra.\nBudget around €600.',
          'gallery.message',
        )}
      />
    </div>
  </div>
)

const ToggleGrid = () => (
  <div
    css={`
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-1) var(--space-5);
    `}
  >
    <Checkbox label="Remember this key" description="Stored in this browser only." />
    <Switch
      label="Web search"
      description="Adds about $0.02 per message."
      checked={atom(true, 'gallery.webSearch')}
    />
    <Checkbox label="Include reasoning" checked={atom(true, 'gallery.reasoning')} />
    <Switch label="Zero data retention" data-gallery-force={forced('focus')} />
    <Checkbox label="Keyboard focus" data-gallery-force={forced('focus')} checked={atom(true, 'gallery.focusCheck')} />
    <Switch label="Send with ⌘ Enter" disabled />
    <Checkbox label="Unavailable for this model" disabled />
    <Switch label="Allow fallbacks" disabled checked={atom(true, 'gallery.fallbacks')} />
  </div>
)

const TabsShowcase = () => (
  <div
    css={`
      display: grid;
      gap: var(--space-5);
    `}
  >
    <Tabs
      label="Reply view"
      selected={atom<'answer' | 'reasoning' | 'sources'>('answer', 'gallery.tabs.reply')}
      items={[
        { id: 'answer', label: 'Answer' },
        { id: 'reasoning', label: 'Reasoning', icon: 'sparkle' },
        { id: 'sources', label: 'Sources', icon: 'globe' },
      ]}
    />
    <Tabs
      label="Settings"
      orientation="vertical"
      selected={atom<'account' | 'appearance' | 'privacy'>('appearance', 'gallery.tabs.settings')}
      items={[
        {
          id: 'account',
          label: 'Account',
          icon: 'key',
          panel: () => <p css="margin: 0;">Key and limits.</p>,
        },
        {
          id: 'appearance',
          label: 'Appearance',
          icon: 'sun',
          panel: () => (
            <div
              css={`
                display: grid;
                gap: var(--space-2);
                color: var(--text-muted);
                font-size: var(--text-sm);
              `}
            >
              <strong css="color: var(--text); font-weight: var(--weight-medium);">Theme</strong>
              <div css="display: flex; gap: var(--space-2); flex-wrap: wrap;">
                <Chip icon="sun">Light</Chip>
                <Chip icon="moon">Dark</Chip>
                <Chip icon="monitor" selected>
                  System
                </Chip>
              </div>
            </div>
          ),
        },
        {
          id: 'privacy',
          label: 'Privacy',
          icon: 'lock',
          panel: () => <p css="margin: 0;">Data collection.</p>,
        },
      ]}
    />
  </div>
)

const OverlayShowcase = () => (
  <div
    data-gallery="menu"
    css={`
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-height: 21rem;
      align-items: flex-start;
      align-content: flex-start;
      flex-wrap: wrap;
    `}
  >
    <Menu
      label="Chat actions"
      placement="bottom-start"
      items={[
        { label: 'Rename', icon: 'edit', onSelect: () => {} },
        { label: 'Pin', icon: 'pin', hint: '⌘ P', onSelect: () => {} },
        { label: 'Export as Markdown', icon: 'download', onSelect: () => {} },
        { label: 'Fork from here', icon: 'branch', disabled: true, onSelect: () => {} },
        { separator: true },
        { label: 'Delete', icon: 'trash', tone: 'danger', onSelect: () => {} },
      ]}
    />
    <span
      css={`
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        color: var(--text-muted);
        font-size: var(--text-sm);
        margin-left: auto;
      `}
    >
      What is BYOK?
      <InfoButton label="About BYOK" title="Bring your own key">
        Requests use your provider key through OpenRouter. OpenRouter charges a small fee
        instead of the model price.
      </InfoButton>
    </span>
  </div>
)

const DialogPreview = () => (
  <div
    css={`
      display: grid;
      place-items: center;
      padding: var(--space-6) var(--space-5);
      border-radius: var(--radius-md);
      background: var(--backdrop);
    `}
  >
    <div
      css={`
        ${dialogSurfaceStyles}
        --dialog-width: 100%;
      `}
    >
      <header data-dialog-header="">
        <h3 data-dialog-title="">Delete all chats?</h3>
        <IconButton icon="close" label="Close" />
        <p data-dialog-description="">
          This removes 42 chats from this browser. It can't be undone.
        </p>
      </header>
      <footer data-dialog-footer="">
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">Delete all</Button>
      </footer>
    </div>
  </div>
)

const FeedbackShowcase = () => (
  <div
    css={`
      display: grid;
      gap: var(--space-4);
    `}
  >
    <div
      css={`
        display: flex;
        align-items: center;
        gap: var(--space-4);
        color: var(--text-muted);
        font-size: var(--text-sm);
      `}
    >
      <Spinner label="Loading" size="0.875rem" />
      <Spinner label="Loading" />
      <span css="color: var(--accent-text); display: inline-flex;">
        <Spinner label="Loading" size="1.5rem" />
      </span>
      <span>Generating reply…</span>
    </div>
    <div
      css={`
        display: grid;
        grid-template-columns: 2rem minmax(0, 1fr);
        gap: var(--space-3);
        align-items: start;
      `}
    >
      <Skeleton width="2rem" height="2rem" radius="var(--radius-pill)" />
      <Skeleton lines={3} />
    </div>
    <div
      css={`
        display: grid;
        gap: var(--space-2);
        padding: var(--space-3) var(--space-4);
        border: 1px dashed var(--line-strong);
        border-radius: var(--radius-md);
        font-size: var(--text-sm);
      `}
    >
      <div css="display: flex; align-items: center; justify-content: space-between; gap: var(--space-2);">
        <span css="color: var(--text-muted);">Live region</span>
        <Badge tone="accent">aria-live · polite</Badge>
      </div>
      <strong css="font-family: var(--font-display); font-size: var(--text-lg); font-weight: var(--weight-regular);">
        {() => lastAnnouncement() || '—'}
      </strong>
    </div>
  </div>
)

const Swatches = () => (
  <div
    css={`
      display: grid;
      gap: var(--space-4);
    `}
  >
    {colorTokenGroups.map((group) => (
      <div
        css={`
          display: grid;
          grid-template-columns: 5rem repeat(6, minmax(0, 1fr));
          align-items: center;
          gap: var(--space-2);
        `}
      >
        <StateLabel>{group.title}</StateLabel>
        {group.tokens.map((token) => (
          <div
            css={`
              display: grid;
              gap: var(--space-1);
            `}
          >
            <span
              css:swatch={`var(--${token})`}
              css={`
                height: 2.5rem;
                border-radius: var(--radius-sm);
                background: var(--swatch);
                box-shadow: inset 0 0 0 1px var(--line);
              `}
            />
            <code
              css={`
                color: var(--text-muted);
                font-family: var(--font-mono);
                font-size: var(--text-2xs);
                line-height: var(--leading-snug);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              `}
            >
              {token}
            </code>
          </div>
        ))}
      </div>
    ))}
  </div>
)

const typeSpecimens = [
  { token: '3xl', family: 'display', sample: 'Good evening' },
  { token: '2xl', family: 'display', sample: 'Think it through' },
  { token: 'xl', family: 'display', sample: 'Trip to Lisbon' },
  { token: 'lg', family: 'display', sample: 'Choose a model' },
  { token: 'md', family: 'ui', sample: 'Answers read at 16 px on a 1.55 line height.' },
  { token: 'base', family: 'ui', sample: 'Controls and labels use 15 px medium.' },
  { token: 'sm', family: 'ui', sample: 'Secondary text, menus, and chips.' },
  { token: 'xs', family: 'ui', sample: '≈ 0.04¢ · 1.2k tokens · 3.4 s' },
  { token: 'sm', family: 'mono', sample: 'const reply = await openRouter.chat.send()' },
] as const

const TypeScale = () => (
  <div
    css={`
      display: grid;
      gap: var(--space-3);
    `}
  >
    {typeSpecimens.map((specimen) => (
      <div
        css={`
          display: grid;
          grid-template-columns: 3.5rem minmax(0, 1fr);
          align-items: baseline;
          gap: var(--space-3);
        `}
      >
        <code
          css={`
            max-width: 100%;
            color: var(--text-faint);
            font-family: var(--font-mono);
            font-size: var(--text-2xs);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          `}
        >
          {specimen.family === 'mono' ? 'mono' : specimen.token}
        </code>
        <span
          css:size={`var(--text-${specimen.token})`}
          css:family={`var(--font-${specimen.family})`}
          data-family={specimen.family}
          css={`
            font-family: var(--family);
            font-size: var(--size);
            line-height: var(--leading-tight);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;

            &[data-family='display'] {
              letter-spacing: var(--tracking-display);
            }

            &[data-family='ui'] {
              line-height: var(--leading-body);
            }
          `}
        >
          {specimen.sample}
        </span>
      </div>
    ))}
  </div>
)

const spaceSteps = ['1', '2', '3', '4', '5', '6', '7', '8'] as const
const radiusSteps = ['xs', 'sm', 'md', 'lg', 'xl', 'pill'] as const
const shadowSteps = ['1', '2', '3', '4'] as const

const motionTokens = [
  { name: 'standard', curve: [0.2, 0, 0, 1], duration: 'fast · 140ms' },
  { name: 'enter', curve: [0, 0, 0, 1], duration: 'base · 220ms' },
  { name: 'exit', curve: [0.3, 0, 1, 1], duration: 'fast · 140ms' },
  { name: 'emphasized', curve: [0.3, 1.25, 0.5, 1], duration: 'slow · 360ms' },
] as const

const Foundations = () => (
  <div
    css={`
      display: grid;
      gap: var(--space-5);
    `}
  >
    <div css="display: grid; gap: var(--space-2);">
      <StateLabel>Spacing · 4 px rhythm</StateLabel>
      <div css="display: flex; align-items: flex-end; gap: var(--space-3);">
        {spaceSteps.map((step) => (
          <div css="display: grid; justify-items: center; gap: var(--space-1);">
            <span
              css:step={`var(--space-${step})`}
              css={`
                width: var(--step);
                height: var(--step);
                border-radius: 3px;
                background: var(--accent-soft-hover);
                box-shadow: inset 0 0 0 1px var(--accent);
              `}
            />
            <code css="font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-faint);">
              {step}
            </code>
          </div>
        ))}
      </div>
    </div>
    <div css="display: grid; gap: var(--space-2);">
      <StateLabel>Radius</StateLabel>
      <div css="display: flex; gap: var(--space-3);">
        {radiusSteps.map((step) => (
          <div css="display: grid; justify-items: center; gap: var(--space-1);">
            <span
              css:radius={`var(--radius-${step})`}
              css={`
                width: 3rem;
                height: 3rem;
                border: 1px solid var(--line-strong);
                border-radius: var(--radius);
                background: var(--bg-sunken);
              `}
            />
            <code css="font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-faint);">
              {step}
            </code>
          </div>
        ))}
      </div>
    </div>
    <div css="display: grid; gap: var(--space-2);">
      <StateLabel>Elevation</StateLabel>
      <div
        css={`
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: var(--space-4);
          padding: var(--space-4);
          border-radius: var(--radius-md);
          background: var(--bg);
        `}
      >
        {shadowSteps.map((step) => (
          <span
            css:elevation={`var(--shadow-${step})`}
            css={`
              display: grid;
              place-items: center;
              height: 3.5rem;
              border-radius: var(--radius-md);
              background: var(--bg-elevated);
              box-shadow: var(--elevation);
              color: var(--text-muted);
              font-family: var(--font-mono);
              font-size: var(--text-2xs);
            `}
          >
            {`shadow-${step}`}
          </span>
        ))}
      </div>
    </div>
    <div css="display: grid; gap: var(--space-2);">
      <StateLabel>Motion · disabled under prefers-reduced-motion</StateLabel>
      <div
        css={`
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: var(--space-3);
        `}
      >
        {motionTokens.map((token) => {
          const [x1, y1, x2, y2] = token.curve
          const toPoint = (x: number, y: number) => `${4 + x * 52} ${48 - y * 40}`
          return (
            <div
              css={`
                display: grid;
                gap: var(--space-1);
                padding: var(--space-2) var(--space-3);
                border: 1px solid var(--line);
                border-radius: var(--radius-sm);
              `}
            >
              <svg:svg viewBox="0 0 60 52" width="60" height="52" aria-hidden="true">
                <svg:path d="M4 48H56M4 48V4" stroke="var(--line-strong)" fill="none" />
                <svg:path
                  d={`M${toPoint(0, 0)} C${toPoint(x1, y1)} ${toPoint(x2, y2)} ${toPoint(1, 1)}`}
                  stroke="var(--accent)"
                  stroke-width="2"
                  fill="none"
                  stroke-linecap="round"
                />
              </svg:svg>
              <strong css="font-size: var(--text-xs); font-weight: var(--weight-medium);">{token.name}</strong>
              <span css="color: var(--text-faint); font-size: var(--text-2xs);">{token.duration}</span>
            </div>
          )
        })}
      </div>
    </div>
  </div>
)

const IconGrid = () => (
  <div
    css={`
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
      gap: var(--space-1);
    `}
  >
    {iconNames.map((name) => (
      <div
        css={`
          display: grid;
          justify-items: center;
          gap: var(--space-1-5);
          padding: var(--space-3) var(--space-1);
          border-radius: var(--radius-sm);
          color: var(--text);
        `}
      >
        <Icon name={name} label={name} />
        <code
          css={`
            max-width: 100%;
            color: var(--text-faint);
            font-family: var(--font-mono);
            font-size: var(--text-2xs);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          `}
        >
          {name}
        </code>
      </div>
    ))}
  </div>
)

export const PrimitivesGallery = () => (
  <main
    data-gallery-root=""
    css={`
      min-height: 100vh;
      padding: var(--space-7) var(--space-7) 11rem;
      background: var(--bg);
      color: var(--text);
    `}
  >
    <div
      css={`
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: var(--space-5);
        max-width: 84rem;
        margin: 0 auto;
      `}
    >
      <header
        css={`
          grid-column: 1 / -1;
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: var(--space-5);
          padding-bottom: var(--space-3);
        `}
      >
        <div css="display: grid; gap: var(--space-2);">
          <div css="display: flex; align-items: center; gap: var(--space-2);">
            <span
              css={`
                width: 0.7rem;
                height: 0.7rem;
                border-radius: var(--radius-pill);
                background: var(--accent);
                box-shadow: 0 0 0 4px var(--accent-soft);
              `}
            />
            <span css="font-family: var(--font-display); font-size: var(--text-lg); letter-spacing: var(--tracking-tight);">
              Atelier
            </span>
          </div>
          <h1
            css={`
              margin: 0;
              font-family: var(--font-display);
              font-size: var(--text-3xl);
              font-weight: var(--weight-regular);
              line-height: var(--leading-tight);
              letter-spacing: var(--tracking-display);
            `}
          >
            Design system
          </h1>
          <p
            data-gallery="muted-text"
            css={`
              margin: 0;
              max-width: 40rem;
              color: var(--text-muted);
              font-size: var(--text-md);
            `}
          >
            Warm neutrals, a serif voice, and a single terracotta accent. Every control is a
            44 px target, every focus ring is 2 px at 3:1, and all text clears 4.5:1.
          </p>
        </div>
        <div css="display: flex; gap: var(--space-2);">
          {tones.map((tone) => (
            <Badge tone={tone}>{tone}</Badge>
          ))}
        </div>
      </header>

      <Card title="Color" note="Semantic tokens; light and dark share names." span={12}>
        <Swatches />
      </Card>
      <Card title="Type" note="Iowan Old Style for display, Avenir Next for interface." span={7}>
        <TypeScale />
      </Card>
      <Card title="Foundations" span={5}>
        <Foundations />
      </Card>

      <Card title="Buttons" note="Pill shape, 44 px tall. Compact keeps a 44 px target around a 32 px body." span={12} gallery="buttons">
        <ButtonMatrix />
      </Card>

      <Card title="Icon buttons" note="Every icon button carries an accessible label." span={7}>
        <IconButtonRow />
      </Card>
      <Card title="Chips and badges" span={5}>
        <ChipRow />
        <BadgeRow />
      </Card>

      <Card title="Banners" note="Tone is always paired with an icon and a title, never color alone." span={6} gallery="banners">
        <BannerStack />
      </Card>
      <Card title="Fields" span={6} gallery="fields">
        <FieldsGrid />
      </Card>

      <Card title="Toggles" span={6}>
        <ToggleGrid />
      </Card>
      <Card title="Tabs" span={6}>
        <TabsShowcase />
      </Card>

      <Card title="Menu and info" note="Button-triggered, arrow keys, Esc returns focus. Info opens on click or tap." span={4}>
        <OverlayShowcase />
      </Card>
      <Card title="Dialog" span={4}>
        <DialogPreview />
      </Card>
      <Card title="Feedback" span={4}>
        <FeedbackShowcase />
      </Card>

      <Card title="Icons" note="Inline SVG, 24 px grid, 1.75 stroke. Decorative unless labelled." span={12}>
        <IconGrid />
      </Card>
    </div>
    <Toaster />
    <LiveRegion />
  </main>
)
