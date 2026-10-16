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
}

export const InspectorTabs = ({ value }: InspectorTabsProps) => {
  return (
    <Tabs
      value={value}
      items={INSPECTOR_TABS}
      ariaLabel="Frame details"
    />
  )
}
