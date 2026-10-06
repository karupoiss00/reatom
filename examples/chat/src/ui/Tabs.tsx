import { atom, type Atom } from '@reatom/core'
import type { JSX } from '@reatom/jsx'

import { Icon, type IconName } from './Icon'
import { resetButton, transition, uniqueId } from './mixins'

export type TabItem<Id extends string = string> = {
  id: Id
  label: string
  icon?: IconName
  panel?: () => JSX.Element
}

export type TabsProps<Id extends string = string> = {
  label: string
  items: ReadonlyArray<TabItem<Id>>
  selected: Atom<Id>
  orientation?: 'horizontal' | 'vertical'
}

export const Tabs = <Id extends string>({
  label,
  items,
  selected,
  orientation = 'horizontal',
}: TabsProps<Id>) => {
  const baseId = uniqueId('tabs')
  const tabId = (id: Id) => `${baseId}-tab-${id}`
  const panelId = (id: Id) => `${baseId}-panel-${id}`
  const hasPanels = items.some((item) => item.panel)
  const layoutOrientation = atom<'horizontal' | 'vertical'>(
    orientation,
    `${baseId}.layoutOrientation`,
  )
  const compactLayoutQuery = '(max-width: 560px)'

  const focusTab = (tablist: HTMLElement, index: number) => {
    const tabs = [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')]
    const target = tabs[(index + tabs.length) % tabs.length]
    target?.focus()
    target?.click()
  }

  const onKeyDown = (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
    const tablist = event.currentTarget
    const tabs = [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')]
    const current = tabs.indexOf(document.activeElement as HTMLElement)
    const laidOutInRow = getComputedStyle(tablist).flexDirection.startsWith('row')
    const previousKey = laidOutInRow ? 'ArrowLeft' : 'ArrowUp'
    const nextKey = laidOutInRow ? 'ArrowRight' : 'ArrowDown'
    const keyToIndex: Record<string, number> = {
      [previousKey]: current - 1,
      [nextKey]: current + 1,
      Home: 0,
      End: tabs.length - 1,
    }
    if (!(event.key in keyToIndex)) return
    event.preventDefault()
    focusTab(tablist, keyToIndex[event.key]!)
  }

  return (
    <div
      data-orientation={orientation}
      css={`
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        min-width: 0;

        &[data-orientation='vertical'] {
          flex-direction: row;
          gap: var(--space-5);
        }

        @media (max-width: 560px) {
          &[data-orientation='vertical'] {
            flex-direction: column;
            gap: var(--space-3);
          }
        }
      `}
    >
      <div
        attr:role="tablist"
        attr:aria-label={label}
        attr:aria-orientation={layoutOrientation}
        data-orientation={orientation}
        on:keydown={onKeyDown}
        ref={() => {
          if (orientation === 'horizontal') return
          const query = window.matchMedia(compactLayoutQuery)
          const sync = () =>
            layoutOrientation.set(query.matches ? 'horizontal' : 'vertical')
          sync()
          query.addEventListener('change', sync)
          return () => query.removeEventListener('change', sync)
        }}
        css={`
          display: flex;
          gap: var(--space-1);
          padding: var(--space-1);
          border-radius: var(--radius-md);
          background: var(--bg-sunken);
          overflow-x: auto;
          scrollbar-width: none;

          &[data-orientation='vertical'] {
            flex-direction: column;
            flex: none;
            width: 12rem;
            padding: 0;
            background: transparent;
          }

          @media (max-width: 560px) {
            &[data-orientation='vertical'] {
              flex-direction: row;
              width: auto;
              padding: var(--space-1);
              background: var(--bg-sunken);
            }
          }
        `}
      >
        {items.map((item) => (
          <button
            type="button"
            id={tabId(item.id)}
            attr:role="tab"
            attr:aria-selected={() => (selected() === item.id ? 'true' : 'false')}
            attr:aria-controls={item.panel ? panelId(item.id) : null}
            attr:tabindex={() => (selected() === item.id ? '0' : '-1')}
            on:click={() => selected.set(item.id)}
            data-orientation={orientation}
            css={`
              ${resetButton}
              display: inline-flex;
              align-items: center;
              gap: var(--space-2);
              flex: none;
              min-height: var(--hit);
              padding: 0 var(--space-4);
              border-radius: calc(var(--radius-md) - 4px);
              color: var(--text-muted);
              font-size: var(--text-sm);
              font-weight: var(--weight-medium);
              white-space: nowrap;
              ${transition('background-color, color, box-shadow')}

              &:hover {
                color: var(--text);
                background: var(--surface-hover);
              }

              &[aria-selected='true'] {
                color: var(--text);
                background: var(--bg-elevated);
                box-shadow: var(--shadow-1);
              }

              &[data-orientation='vertical'] {
                justify-content: flex-start;
                padding: 0 var(--space-3);
              }

              &[data-orientation='vertical'][aria-selected='true'] {
                background: var(--surface-active);
                box-shadow: none;
              }

              @media (max-width: 560px) {
                &[data-orientation='vertical'] {
                  padding: 0 var(--space-4);
                }

                &[data-orientation='vertical'][aria-selected='true'] {
                  background: var(--bg-elevated);
                  box-shadow: var(--shadow-1);
                }
              }
            `}
          >
            {item.icon ? <Icon name={item.icon} size="1.125rem" /> : null}
            {item.label}
          </button>
        ))}
      </div>
      {hasPanels
        ? () => {
            const current = items.find((item) => item.id === selected())
            if (!current?.panel) return null
            return (
              <div
                id={panelId(current.id)}
                attr:role="tabpanel"
                attr:aria-labelledby={tabId(current.id)}
                attr:tabindex="0"
                css={`
                  flex: 1;
                  min-width: 0;
                  animation: ui-fade var(--duration-fast) var(--ease-enter);

                  &:focus-visible {
                    outline-offset: 4px;
                    border-radius: var(--radius-sm);
                  }
                `}
              >
                {current.panel()}
              </div>
            )
          }
        : null}
    </div>
  )
}
