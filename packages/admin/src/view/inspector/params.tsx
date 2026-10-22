import { atom, type AtomLike } from '@reatom/core'

import { tokens, type } from '../design-system'
import { Inspector } from './Inspector'

const expandedValueHooks = {
  initiallyExpanded: () => true,
}

export interface ParamEntry {
  label: string
  value: unknown
}

export function paramEntries(value: unknown): ParamEntry[] {
  if (value === undefined) return []
  const items = Array.isArray(value) ? value : [value]
  if (items.length === 0) return []
  if (items.length === 1) return [{ label: 'Param', value: items[0] }]
  return Array.from({ length: items.length }, (_, index) => ({
    label: `Param${index + 1}`,
    value: items[index],
  }))
}

let serial = 0

const ParamRow = ({ label, value }: ParamEntry) => {
  serial += 1
  const source = atom(value, `_Admin.inspector.param.${serial}`)
  return (
    <div
      css={`
        display: grid;
        gap: var(--admin-space-4);
        min-width: 0;
      `}
    >
      <span
        css={`
          ${type.data}
          color: ${tokens.accent};
        `}
      >
        {label}
      </span>
      <Inspector value={source} defaultExpanded hooks={expandedValueHooks} />
    </div>
  )
}

export const ParamList = ({ value }: { value: AtomLike<unknown> }) => (
  <div
    data-reatom-name="ParamList"
    css={`
      display: contents;
    `}
  >
    {() =>
      paramEntries(value()).map((entry) => (
        <ParamRow label={entry.label} value={entry.value} />
      ))
    }
  </div>
)
