import type { Atom } from '@reatom/core'

import { focusVisible, interactive } from './mixins'
import { size, tokens, type } from './tokens'

export interface TabItem<T extends string> {
  id: T
  label: string
}

export interface TabsProps<T extends string> {
  value: Atom<T>
  items: Array<TabItem<T>>
  ariaLabel: string
}

export const Tabs = <T extends string>({
  value,
  items,
  ariaLabel,
}: TabsProps<T>) => {
  const selectByOffset = (offset: number): number => {
    const currentIndex = items.findIndex((item) => item.id === value())
    const nextIndex = (currentIndex + offset + items.length) % items.length
    const nextItem = items[nextIndex]
    if (nextItem) value.set(nextItem.id)
    return nextIndex
  }

  const focusTab = (target: EventTarget | null, index: number) => {
    if (!(target instanceof HTMLElement)) return
    const tab = target.children.item(index)
    if (tab instanceof HTMLElement) tab.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      css={`
        display: flex;
        align-items: stretch;
        min-height: ${size.tabs};
        min-width: 0;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: thin;
        gap: var(--admin-space-2);
        border-bottom: 1px solid ${tokens.border1};
        background: ${tokens.surface1};
      `}
      on:keydown={(event: KeyboardEvent) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault()
          focusTab(event.currentTarget, selectByOffset(1))
          return
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault()
          focusTab(event.currentTarget, selectByOffset(-1))
          return
        }
        if (event.key === 'Home') {
          event.preventDefault()
          const first = items[0]
          if (first) value.set(first.id)
          focusTab(event.currentTarget, 0)
          return
        }
        if (event.key === 'End') {
          event.preventDefault()
          const last = items[items.length - 1]
          if (last) value.set(last.id)
          focusTab(event.currentTarget, items.length - 1)
        }
      }}
    >
      {items.map((item) => (
        <button
          type="button"
          role="tab"
          aria-label={item.label}
          aria-selected={() => value() === item.id}
          tabindex={() => (value() === item.id ? 0 : -1)}
          css={`
            ${type.ui}
            ${interactive}
            ${focusVisible}
            appearance: none;
            flex: none;
            white-space: nowrap;
            border: 0;
            background: transparent;
            color: ${tokens.text2};
            padding-inline: var(--admin-space-12);
            &[aria-selected='true'] {
              color: ${tokens.text1};
              box-shadow: inset 0 -2px 0 ${tokens.accent};
            }
          `}
          on:click={() => value.set(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
