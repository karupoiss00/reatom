import { ui } from '../../app/ui'
import { listedBindings } from '../../shortcuts/bindings'
import { Dialog } from '../../ui'

const chordStyles = `
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  padding: 0.15rem 0.45rem;
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.4;
  white-space: nowrap;
`

export const ShortcutsDialog = () => (
  <div data-slot="ShortcutsDialog" css="display: contents;">
    <Dialog open={ui.shortcuts} title="Keyboard shortcuts" size="sm">
      <p
        css={`
          margin: 0 0 var(--space-3);
          color: var(--text-muted);
          font-size: var(--text-sm);
          line-height: var(--leading-snug);
        `}
      >
        These follow the send key in Settings.
      </p>
      <ul
        css={`
          display: grid;
          margin: 0;
          padding: 0;
          list-style: none;
        `}
      >
        {() =>
          ui.shortcuts()
            ? listedBindings().map((binding) => (
                <li
                  data-shortcut={binding.id}
                  css={`
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto;
                    align-items: center;
                    gap: var(--space-4);
                    min-height: 2.25rem;
                    border-top: 1px solid var(--line);
                  `}
                >
                  <span data-label="">{binding.label}</span>
                  <kbd data-chord="" css={chordStyles}>
                    {binding.chord}
                  </kbd>
                </li>
              ))
            : null
        }
      </ul>
    </Dialog>
  </div>
)
