import { atom } from '@reatom/core'

import type { MessageId } from '../storage/types'
import { openLayerCount as primitiveLayerCount } from '../ui'

export type AppSettingsSection =
  | 'account'
  | 'appearance'
  | 'data'
  | 'privacy'
  | 'keyboard'
  | 'mcp'
export const appSettingsSectionIds = [
  'account',
  'appearance',
  'data',
  'privacy',
  'keyboard',
  'mcp',
] as const satisfies readonly AppSettingsSection[]
export type ChatSettingsSection = 'prompt' | 'advanced' | 'privacy' | 'routing'
export type PickerRequest = null | {
  purpose: 'chat' | 'regenerate' | 'compare'
  messageId?: MessageId
}
export interface ExtraEstimateLine {
  key: string
  label: string
  amount: number | null
}

const appSettings = atom<AppSettingsSection | null>(null, 'app.ui.appSettings')
const chatSettings = atom<ChatSettingsSection | null>(
  null,
  'app.ui.chatSettings',
)
const picker = atom<PickerRequest>(null, 'app.ui.picker')
const search = atom(false, 'app.ui.search')
const shortcuts = atom(false, 'app.ui.shortcuts')
const drawer = atom(false, 'app.ui.drawer')
const editing = atom<MessageId | null>(null, 'app.ui.editing')

export const ui = {
  appSettings,
  chatSettings,
  picker,
  search,
  shortcuts,
  drawer,
  editing,
  openLayerCount: primitiveLayerCount,
}

export const extraEstimateLines = atom<ExtraEstimateLine[]>(
  [],
  'app.ui.extraEstimateLines',
)
