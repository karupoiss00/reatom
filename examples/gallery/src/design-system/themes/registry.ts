import { getThemeDefinition } from '../../themeDefinitions'
import type { ResolvedThemeMode, ThemePack } from '../../types'
import type {
  ControlTheme,
  ControlThemeOverrides,
  ThemePackMeta,
} from '../themeTypes'
import { bauhausControlOverrides } from './bauhaus'
import { blueprintControlOverrides } from './blueprint'
import { cartoonControlOverrides } from './cartoon'
import { glassControlOverrides } from './glass'
import { minimalControlOverrides } from './minimal'
import { obsidianControlOverrides } from './obsidian'
import { paperControlOverrides } from './paper'
import { polaroidControlOverrides } from './polaroid'
import {
  assertControlTheme,
  controlThemeToCssVars,
  deriveControlTheme,
} from './resolveControlTheme'
import { retroOsControlOverrides } from './retroOs'
import { terminalControlOverrides } from './terminal'

export const THEME_PACK_IDS = [
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

export const THEME_PACKS: ThemePackMeta[] = [
  {
    value: 'cartoon',
    label: 'Cartoon',
    description: 'Comic lettering, bold ink and halftone paper',
    swatches: ['#111111', '#ffffff', '#bdbdbd'],
  },
  {
    value: 'blueprint',
    label: 'Blueprint',
    description: 'Architectural sheets, cobalt ink, measured details',
    swatches: ['#234fa0', '#dbe7fa', '#f4f3ec'],
  },
  {
    value: 'terminal',
    label: 'Terminal',
    description: 'Monospace TUI, scanlines, hard edges',
    swatches: ['#7cff6b', '#0b120b', '#f4f6ef'],
  },
  {
    value: 'paper',
    label: 'Paper',
    description: 'Warm whites, clean lines, blue and blush details',
    swatches: ['#526f86', '#e8b4bc', '#f7f7f2'],
  },
  {
    value: 'polaroid',
    label: 'Polaroid',
    description: 'Photo prints, desk shadows, tape labels',
    swatches: ['#d94f45', '#f6ead2', '#5f7ea3'],
  },
  {
    value: 'obsidian',
    label: 'Obsidian',
    description: 'Volcanic glass, Gothic arches and silver light',
    swatches: ['#0b0c10', '#51435f', '#c6bfd8'],
  },
  {
    value: 'bauhaus',
    label: 'Bauhaus',
    description: 'Primary blocks, bold flat geometry',
    swatches: ['#c63c2b', '#e8bb35', '#254bbc'],
  },
  {
    value: 'glass',
    label: 'Glass',
    description: 'Clear lenses, silver light, optical depth',
    swatches: ['#ffffff', '#c7c7c7', '#333333'],
  },
  {
    value: 'minimal',
    label: 'Minimal',
    description: 'A photographic index. Space, type, and nothing extra.',
    swatches: ['#111111', '#777777', '#f7f7f7'],
  },
  {
    value: 'retroOs',
    label: 'Retro OS',
    description: 'Beveled windows, segmented controls',
    swatches: ['#2563eb', '#c7c7c7', '#3f3f46'],
  },
]

type ControlThemeOverrideSource =
  ControlThemeOverrides | ((mode: ResolvedThemeMode) => ControlThemeOverrides)

const controlOverrides: Record<ThemePack, ControlThemeOverrideSource> = {
  cartoon: cartoonControlOverrides,
  blueprint: blueprintControlOverrides,
  terminal: terminalControlOverrides,
  paper: paperControlOverrides,
  polaroid: polaroidControlOverrides,
  obsidian: obsidianControlOverrides,
  bauhaus: bauhausControlOverrides,
  glass: glassControlOverrides,
  minimal: minimalControlOverrides,
  retroOs: retroOsControlOverrides,
}

const resolveOverrides = (
  source: ControlThemeOverrideSource,
  mode: ResolvedThemeMode,
): ControlThemeOverrides =>
  typeof source === 'function' ? source(mode) : source

export const resolveRegisteredControlTheme = (
  pack: ThemePack,
  mode: ResolvedThemeMode,
): ControlTheme => {
  const theme = deriveControlTheme(
    getThemeDefinition(pack)[mode],
    resolveOverrides(controlOverrides[pack], mode),
  )
  assertControlTheme(theme, `${pack}/${mode}`)
  return theme
}

export const resolveThemeCssVars = (
  pack: ThemePack,
  mode: ResolvedThemeMode,
): Record<string, string> => ({
  ...getThemeDefinition(pack)[mode],
  ...controlThemeToCssVars(resolveRegisteredControlTheme(pack, mode)),
})

export const resolveViewerControlCssVars = (
  pack: ThemePack,
  mode: ResolvedThemeMode,
): Record<`--${string}`, string> =>
  controlThemeToCssVars(resolveRegisteredControlTheme(pack, mode), ['viewer'])

for (const pack of THEME_PACK_IDS) {
  resolveRegisteredControlTheme(pack, 'light')
  resolveRegisteredControlTheme(pack, 'dark')
}

export const isThemePack = (value: unknown): value is ThemePack =>
  THEME_PACK_IDS.some((pack) => pack === value)
