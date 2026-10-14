import { atom, withLocalStorage } from '@reatom/core'

import { defaultGlobalPrivacy } from './records'
import type { McpServerPref, PrivacySettings } from './types'

export type { McpServerPref }

export type ThemePref = 'light' | 'dark' | 'system'
export type SendKey = 'enter' | 'mod-enter'

const recentModelsLimit = 5

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const readStringArray = (snapshot: unknown) =>
  isStringArray(snapshot) ? snapshot : []

const readBoolean = (snapshot: unknown, fallback: boolean) =>
  typeof snapshot === 'boolean' ? snapshot : fallback

export const themePref = atom<ThemePref>('system', 'prefs.theme').extend(
  withLocalStorage({
    key: 'atelier.theme',
    fromSnapshot: (snapshot: unknown): ThemePref =>
      snapshot === 'light' || snapshot === 'dark' ? snapshot : 'system',
  }),
)

export const sidebarCollapsed = atom(false, 'prefs.sidebarCollapsed').extend(
  withLocalStorage({
    key: 'atelier.sidebarCollapsed',
    fromSnapshot: (snapshot: unknown) => readBoolean(snapshot, false),
  }),
)

export const sendKey = atom<SendKey>('enter', 'prefs.sendKey').extend(
  withLocalStorage({
    key: 'atelier.sendKey',
    fromSnapshot: (snapshot: unknown): SendKey =>
      snapshot === 'mod-enter' ? 'mod-enter' : 'enter',
  }),
)

export const globalPrivacy = atom<PrivacySettings>(
  { ...defaultGlobalPrivacy },
  'prefs.globalPrivacy',
).extend(
  withLocalStorage({
    key: 'atelier.globalPrivacy',
    fromSnapshot: (snapshot: unknown): PrivacySettings => {
      const candidate = snapshot as Partial<PrivacySettings> | null
      return {
        denyDataCollection: readBoolean(
          candidate?.denyDataCollection,
          defaultGlobalPrivacy.denyDataCollection,
        ),
        zdr: readBoolean(candidate?.zdr, defaultGlobalPrivacy.zdr),
      }
    },
  }),
)

export const favoriteModels = atom<string[]>([], 'prefs.favoriteModels').extend(
  withLocalStorage({
    key: 'atelier.favoriteModels',
    fromSnapshot: readStringArray,
  }),
)

export const recentModels = atom<string[]>([], 'prefs.recentModels').extend(
  withLocalStorage({
    key: 'atelier.recentModels',
    fromSnapshot: (snapshot: unknown) =>
      readStringArray(snapshot).slice(0, recentModelsLimit),
  }),
)

export const lastPickedModel = atom<string | null>(
  null,
  'prefs.lastPickedModel',
).extend(
  withLocalStorage({
    key: 'atelier.lastPickedModel',
    fromSnapshot: (snapshot: unknown) =>
      typeof snapshot === 'string' && snapshot.length > 0 ? snapshot : null,
  }),
)

export const webSearchNoticeSeen = atom(
  false,
  'prefs.webSearchNoticeSeen',
).extend(
  withLocalStorage({
    key: 'atelier.webSearchNoticeSeen',
    fromSnapshot: (snapshot: unknown) => readBoolean(snapshot, false),
  }),
)

export const unlimitedAckHashes = atom<string[]>(
  [],
  'prefs.unlimitedAckHashes',
).extend(
  withLocalStorage({
    key: 'atelier.unlimitedAckHashes',
    fromSnapshot: readStringArray,
  }),
)

export const persistDenied = atom(false, 'prefs.persistDenied').extend(
  withLocalStorage({
    key: 'atelier.persistDenied',
    fromSnapshot: (snapshot: unknown) => readBoolean(snapshot, false),
  }),
)

const storedMcpUrlMaxLength = 2048

export const rewriteMcpLoopbackUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1'
      return parsed.href
    }
    return url
  } catch {
    return url
  }
}

const isStoredHttpUrl = (url: string) => {
  if (url.length === 0 || url.length > storedMcpUrlMaxLength) return false
  if (!/^https?:\/\//i.test(url)) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const readMcpServerPref = (value: unknown): McpServerPref | null => {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as { id?: unknown; url?: unknown; name?: unknown }
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return null
  if (typeof candidate.url !== 'string' || !isStoredHttpUrl(candidate.url)) {
    return null
  }
  const pref: McpServerPref = {
    id: candidate.id,
    url: rewriteMcpLoopbackUrl(candidate.url),
  }
  if (typeof candidate.name === 'string' && candidate.name.length > 0) {
    pref.name = candidate.name
  }
  return pref
}

const readMcpServers = (snapshot: unknown): McpServerPref[] => {
  if (!Array.isArray(snapshot)) return []
  return snapshot.flatMap((item) => {
    const pref = readMcpServerPref(item)
    return pref ? [pref] : []
  })
}

export const mcpServers = atom<McpServerPref[]>([], 'prefs.mcpServers').extend(
  withLocalStorage({
    key: 'atelier.mcpServers',
    fromSnapshot: readMcpServers,
  }),
)

export const pushRecentModel = (recent: string[], modelId: string) =>
  [modelId, ...recent.filter((id) => id !== modelId)].slice(
    0,
    recentModelsLimit,
  )
