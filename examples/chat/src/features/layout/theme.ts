import { action, computed } from '@reatom/core'

import { systemDark } from '../../platform/env'
import { type ThemePref, themePref } from '../../storage/prefs'
import type { ThemeName } from '../../ui'

export const themeColors: Record<ThemeName, string> = {
  light: '#f6f5f2',
  dark: '#141413',
}

export const resolvedTheme = computed((): ThemeName => {
  const pref = themePref()
  if (pref !== 'system') return pref
  return systemDark() ? 'dark' : 'light'
}, 'layout.theme.resolved')

const applyTheme = (pref: ThemePref, theme: ThemeName) => {
  const root = document.documentElement
  if (root.dataset.theme !== theme) root.dataset.theme = theme
  if (root.dataset.themePref !== pref) root.dataset.themePref = pref
  let themeColorMeta = document.querySelector('meta[name="theme-color"]')
  if (!themeColorMeta) {
    themeColorMeta = document.createElement('meta')
    themeColorMeta.setAttribute('name', 'theme-color')
    document.head.append(themeColorMeta)
  }
  themeColorMeta.setAttribute('content', themeColors[theme])
}

export const selectTheme = action((pref: ThemePref) => {
  themePref.set(pref)
  applyTheme(pref, resolvedTheme())
}, 'layout.theme.select')

const documentTheme = computed(
  () => `${themePref()}:${resolvedTheme()}`,
  'layout.theme.document',
)

/**
 * Keeps the root attribute in sync with the preference and the OS scheme;
 * returns the stop function.
 */
export const syncThemeToDocument = () =>
  documentTheme.subscribe(() => applyTheme(themePref(), resolvedTheme()))
