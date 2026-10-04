import { clearStack, context } from '@reatom/core'
import { expect, test } from 'vitest'

import {
  filterPanelOpen,
  settingsPanelOpen,
  toggleFilterPanel,
  toggleSettingsPanel,
} from './panels'

test.beforeEach(() => clearStack())

test('opening filters closes settings', () =>
  context.start(() => {
    settingsPanelOpen.set(true)
    toggleFilterPanel()
    expect(filterPanelOpen()).toBe(true)
    expect(settingsPanelOpen()).toBe(false)
  }))

test('opening settings closes filters', () =>
  context.start(() => {
    filterPanelOpen.set(true)
    toggleSettingsPanel()
    expect(settingsPanelOpen()).toBe(true)
    expect(filterPanelOpen()).toBe(false)
  }))

test('toggling an open panel closes it without touching the other', () =>
  context.start(() => {
    filterPanelOpen.set(true)
    toggleFilterPanel()
    expect(filterPanelOpen()).toBe(false)
    expect(settingsPanelOpen()).toBe(false)

    settingsPanelOpen.set(true)
    toggleSettingsPanel()
    expect(settingsPanelOpen()).toBe(false)
    expect(filterPanelOpen()).toBe(false)
  }))
