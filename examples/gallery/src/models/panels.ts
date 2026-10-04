import { action, atom, reatomBoolean } from '@reatom/core'

export { activeFilterCount } from './filters'

export const filterPanelOpen = atom(false, 'filterPanelOpen')
export const settingsPanelOpen = atom(false, 'settingsPanelOpen')
export const imageInfoPanelOpen = reatomBoolean(false, 'imageInfoPanel.open')

export const toggleFilterPanel = action(() => {
  filterPanelOpen.set((open) => !open)
  if (filterPanelOpen()) settingsPanelOpen.set(false)
}, 'panels.toggleFilter')

export const toggleSettingsPanel = action(() => {
  settingsPanelOpen.set((open) => !open)
  if (settingsPanelOpen()) filterPanelOpen.set(false)
}, 'panels.toggleSettings')
