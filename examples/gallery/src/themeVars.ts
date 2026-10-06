import { cssVar } from '@reatom/jsx'

import type { ThemePack } from './types'

const THEME_PACK_VALUES = [
  'blueprint',
  'terminal',
  'paper',
  'polaroid',
  'obsidian',
  'bauhaus',
  'glass',
  'minimal',
  'retroOs',
  'cartoon',
] as const satisfies readonly ThemePack[]

export const pack = cssVar('theme-pack', THEME_PACK_VALUES)
export const mode = cssVar('theme-mode', ['light', 'dark'] as const)
