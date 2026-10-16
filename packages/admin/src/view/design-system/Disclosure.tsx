import { atom, type Atom } from '@reatom/core'

import { focusVisible } from './mixins'
import { tokens, type } from './tokens'

let disclosureCounter = 0

export interface DisclosureProps {
  /** Summary shown when the section is collapsed or open. */
  label: string
  /**
   * Controlled open state. Omit it for an internal atom that starts closed.
   * When passed, this is the atom the summary writes.
   */
  open?: Atom<boolean>
  onToggle?: (open: boolean) => void
  children?: Element | string | Array<Element | string | null>
}

/** One collapsed section. Starts closed unless `open` is already true. */
export const Disclosure = ({
  label,
  open,
  onToggle,
  children,
}: DisclosureProps) => {
  const state =
    open ?? atom(false, `_Admin.disclosure.open.${++disclosureCounter}`)

  return (
    <details
      data-reatom-name="Disclosure"
      prop:open={() => state()}
      css={`
        ${type.ui}
        color: ${tokens.text1};
        summary {
          list-style: none;
        }
        summary::-webkit-details-marker {
          display: none;
        }
      `}
      on:toggle={(event: Event) => {
        const details = event.currentTarget
        if (!(details instanceof HTMLDetailsElement)) return
        if (details.open === state()) return
        state.set(details.open)
        onToggle?.(details.open)
      }}
    >
      <summary
        css={`
          ${focusVisible}
          display: flex;
          align-items: center;
          gap: var(--admin-space-6);
          cursor: pointer;
          min-height: var(--admin-control-height);
          color: ${tokens.text1};
        `}
        on:keydown={(event: KeyboardEvent) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          const summary = event.currentTarget
          if (!(summary instanceof HTMLElement)) return
          const details = summary.parentElement
          if (!(details instanceof HTMLDetailsElement)) return
          details.open = !details.open
        }}
      >
        <span
          aria-hidden="true"
          css={`
            color: ${tokens.text2};
          `}
        >
          {() => (state() ? '▾' : '▸')}
        </span>
        {label}
      </summary>
      <div
        css={`
          ${type.body}
          padding-block: var(--admin-space-8);
          color: ${tokens.text2};
        `}
      >
        {children}
      </div>
    </details>
  )
}
