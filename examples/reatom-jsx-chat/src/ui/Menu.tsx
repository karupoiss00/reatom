import type { Atom } from '@reatom/core'
import type { JSX } from '@reatom/jsx'

import { Icon, type IconName } from './Icon'
import { IconButton } from './IconButton'
import { resetButton, transition } from './mixins'
import {
  Popover,
  type PopoverControls,
  type PopoverPlacement,
  type PopoverTriggerProps,
} from './Popover'

export type MenuAction = {
  label: string
  onSelect: () => void
  icon?: IconName
  hint?: string
  tone?: 'danger'
  disabled?: boolean
  selected?: boolean
}

export type MenuSeparator = { separator: true }

export type MenuItem = MenuAction | MenuSeparator

export type MenuProps = {
  label: string
  items: MenuItem[] | (() => MenuItem[])
  trigger?: (props: PopoverTriggerProps) => JSX.Element
  placement?: PopoverPlacement
  open?: Atom<boolean>
  width?: string
}

const isSeparator = (item: MenuItem): item is MenuSeparator => 'separator' in item

const menuItems = (panel: HTMLElement) => [
  ...panel.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
]

const moveFocus = (panel: HTMLElement, step: 1 | -1 | 'first' | 'last') => {
  const items = menuItems(panel)
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLElement)
  const nextIndex =
    step === 'first'
      ? 0
      : step === 'last'
        ? items.length - 1
        : (current + step + items.length) % items.length
  items[nextIndex]?.focus()
}

const handleMenuKeys = (event: KeyboardEvent, controls: PopoverControls) => {
  const panel = event.currentTarget as HTMLElement
  const keyToStep = {
    ArrowDown: 1,
    ArrowUp: -1,
    Home: 'first',
    End: 'last',
  } as const
  if (event.key in keyToStep) {
    event.preventDefault()
    moveFocus(panel, keyToStep[event.key as keyof typeof keyToStep])
    return
  }
  if (event.key === 'Tab') {
    controls.close({ restoreFocus: false })
    return
  }
  const isTypeahead =
    event.key.length === 1 &&
    event.key.trim() !== '' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  if (isTypeahead) {
    event.preventDefault()
    focusByFirstLetter(panel, event.key)
  }
}

const focusByFirstLetter = (panel: HTMLElement, letter: string) => {
  const items = menuItems(panel)
  const current = items.indexOf(document.activeElement as HTMLElement)
  const needle = letter.toLocaleLowerCase()
  for (let offset = 1; offset <= items.length; offset++) {
    const candidate = items[(current + offset + items.length) % items.length]!
    const label = candidate.dataset.menuLabel ?? candidate.textContent ?? ''
    if (label.trim().toLocaleLowerCase().startsWith(needle)) {
      candidate.focus()
      return
    }
  }
}

const MenuRow = ({
  item,
  controls,
}: {
  item: MenuAction
  controls: PopoverControls
}) => (
  <button
    type="button"
    attr:role={item.selected === undefined ? 'menuitem' : 'menuitemradio'}
    attr:aria-checked={
      item.selected === undefined ? null : item.selected ? 'true' : 'false'
    }
    attr:tabindex="-1"
    attr:aria-disabled={item.disabled ? 'true' : null}
    data-menu-label={item.label}
    data-tone={item.tone ?? 'neutral'}
    on:click={() => {
      if (item.disabled) return
      controls.close({ restoreFocus: true })
      item.onSelect()
    }}
    css={`
      ${resetButton}
      display: grid;
      grid-template-columns: 1.25rem minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--space-3);
      width: 100%;
      min-height: var(--hit);
      padding: 0 var(--space-3);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-size: var(--text-sm);
      line-height: var(--leading-snug);
      ${transition('background-color, color')}

      & [data-menu-icon] {
        display: grid;
        place-items: center;
        color: var(--text-muted);
      }

      & [data-menu-hint] {
        color: var(--text-faint);
        font-size: var(--text-xs);
        font-variant-numeric: tabular-nums;
      }

      &:hover:not([aria-disabled='true']),
      &:focus-visible {
        background: var(--surface-hover);
        outline: none;
      }

      &:focus-visible {
        box-shadow: inset 0 0 0 var(--focus-width) var(--focus);
      }

      &[data-tone='danger'] {
        color: var(--danger);

        & [data-menu-icon] {
          color: var(--danger);
        }
      }

      &[data-tone='danger']:hover:not([aria-disabled='true']),
      &[data-tone='danger']:focus-visible {
        background: var(--danger-soft);
      }

      &[aria-checked='true'] [data-menu-check] {
        color: var(--accent-text);
      }

      &[aria-disabled='true'] {
        color: var(--text-disabled);
        cursor: not-allowed;

        & [data-menu-icon] {
          color: var(--text-disabled);
        }
      }
    `}
  >
    <span data-menu-icon="">
      {item.icon ? <Icon name={item.icon} size="1.125rem" /> : null}
    </span>
    <span>{item.label}</span>
    {item.selected ? (
      <span data-menu-check="">
        <Icon name="check" size="1rem" />
      </span>
    ) : item.hint ? (
      <kbd data-menu-hint="" css="font-family: inherit;">
        {item.hint}
      </kbd>
    ) : (
      <span />
    )}
  </button>
)

const MenuSeparatorRow = () => (
  <div
    attr:role="separator"
    css={`
      height: 1px;
      margin: var(--space-1) var(--space-2);
      background: var(--line);
    `}
  />
)

export const Menu = ({
  label,
  items,
  trigger = (props) => <IconButton icon="more" label={label} {...props} />,
  placement = 'bottom-end',
  open,
  width,
}: MenuProps) => {
  const renderItems = (controls: PopoverControls) => {
    const list = typeof items === 'function' ? items() : items
    return list.map((item) =>
      isSeparator(item) ? (
        <MenuSeparatorRow />
      ) : (
        <MenuRow item={item} controls={controls} />
      ),
    )
  }

  return (
    <Popover
      label={label}
      role="menu"
      placement={placement}
      open={open}
      width={width}
      trigger={trigger}
      onOpen={(panel) => moveFocus(panel, 'first')}
      onPanelKeyDown={handleMenuKeys}
    >
      {(controls) =>
        typeof items === 'function'
          ? () => renderItems(controls)
          : renderItems(controls)
      }
    </Popover>
  )
}
