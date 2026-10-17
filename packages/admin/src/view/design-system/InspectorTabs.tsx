import type { Atom } from '@reatom/core'

import { Tabs } from './Tabs'

export type InspectorTabId = 'overview' | 'causes' | 'history' | 'json'

export const INSPECTOR_TABS: Array<{ id: InspectorTabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'causes', label: 'Cause Chain' },
  { id: 'history', label: 'History' },
  { id: 'json', label: 'JSON' },
]

export interface InspectorTabsProps {
  value: Atom<InspectorTabId>
  causeCount?: () => number
  historyCount?: () => number
}

export const InspectorTabs = ({
  value,
  causeCount,
  historyCount,
}: InspectorTabsProps) => {
  return (
    <Tabs
      value={value}
      items={[
        { id: 'overview', label: 'Overview' },
        { id: 'causes', label: 'Cause Chain', count: causeCount },
        { id: 'history', label: 'History', count: historyCount },
        { id: 'json', label: 'JSON' },
      ]}
      ariaLabel="Frame details"
    />
  )
}
