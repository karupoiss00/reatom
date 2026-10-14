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
  const paneMinHeight = atom(0, `${baseId}.paneMinHeight`)
  const layoutOrientation = atom<'horizontal' | 'vertical'>(
    orientation,
    `${baseId}.layoutOrientation`,
  )
  const compactLayoutQuery = '(max-width: 560px)'

  const rememberPaneHeight = (node: HTMLElement) => {
    let frame = 0
    const record = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const child = node.firstElementChild
        const height =
          child instanceof HTMLElement
            ? Math.max(child.scrollHeight, child.offsetHeight)
            : Math.max(node.scrollHeight, node.offsetHeight)
        if (height > 0) {
          paneMinHeight.set((current) => (height > current ? height : current))
        }
      })
    }
    record()
    const observer = new ResizeObserver(record)
    observer.observe(node)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }

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
        flex: 1 1 auto;
        gap: var(--space-3);
        min-width: 0;
        min-height: 0;

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
      {hasPanels ? (
        <div
          data-tabs-panes=""
          css:tabs-pane-min={() => `${paneMinHeight()}px`}
          css={`
            display: grid;
            grid-template-rows: minmax(0, 1fr);
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
            min-height: 0;
            overflow: hidden;
          `}
        >
          <div
            data-tabs-sizer=""
            attr:aria-hidden="true"
            prop:inert={true}
            css={`
              grid-area: 1 / 1;
              min-height: var(--tabs-pane-min, 0px);
              visibility: hidden;
              overflow: hidden;
              pointer-events: none;
            `}
          />
          {items.map((item) => {
            if (!item.panel) return null
            return (
              <div
                id={panelId(item.id)}
                data-tabs-pane={item.id}
                data-active={() => (selected() === item.id ? 'true' : null)}
                attr:role={() => (selected() === item.id ? 'tabpanel' : null)}
                attr:aria-labelledby={() =>
                  selected() === item.id ? tabId(item.id) : null
                }
                attr:aria-hidden={() =>
                  selected() === item.id ? null : 'true'
                }
                attr:tabindex={() => (selected() === item.id ? '0' : '-1')}
                prop:inert={() => selected() !== item.id}
                ref={(node: HTMLElement) => {
                  const stopMeasure = rememberPaneHeight(node)
                  const unsubscribe = selected.subscribe((id) => {
                    if (id === item.id) node.scrollTop = 0
                  })
                  return () => {
                    unsubscribe()
                    stopMeasure()
                  }
                }}
                css={`
                  min-width: 0;
                  min-height: 0;
                  overflow: hidden;
                  pointer-events: none;
                  visibility: hidden;

                  &[data-active='true'] {
                    grid-area: 1 / 1;
                    max-height: 100%;
                    overflow: auto;
                    overscroll-behavior: contain;
                    pointer-events: auto;
                    visibility: visible;
                    animation: ui-fade var(--duration-fast) var(--ease-enter);
                  }

                  &:not([data-active]) {
                    position: absolute;
                    inset-inline: 0;
                    top: 0;
                  }

                  &[data-active='true']:focus-visible {
                    outline-offset: 4px;
                    border-radius: var(--radius-sm);
                  }
                `}
              >
                {item.panel()}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
