import { context } from '@reatom/core'
import { describe, expect, test } from 'vitest'

import { appSettingsSectionIds, type AppSettingsSection } from '../../app/ui'
import {
  createChatRecord,
  createDefaultChatSettings,
  initStorage,
  repo,
} from '../index'
import { mcpServers, rewriteMcpLoopbackUrl } from '../prefs'
import type { McpServerPref } from '../types'

const fusionUrl = 'http://127.0.0.1:27182/mcp'
const localhostUrl = 'http://localhost:27182/mcp'
const fusionServer: McpServerPref = { id: 'fusion', url: fusionUrl }

const readMcpServersSnapshot = () => {
  const raw = localStorage.getItem('atelier.mcpServers')
  if (raw === null) return null
  return JSON.parse(raw) as { data?: unknown }
}

const atelierStoreNames = async () => {
  const names = (await indexedDB.databases()).map((entry) => entry.name)
  if (!names.includes('atelier')) return []
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('atelier')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('missing atelier database'))
  })
  database.onversionchange = () => database.close()
  try {
    return [...database.objectStoreNames]
  } finally {
    database.close()
  }
}

describe('F-29 Connect Fusion MCP', () => {
  test('Pasting http://127.0.0.1:27182/mcp is enough; the URL is stored in the server list', () => {
    mcpServers.set([fusionServer])
    expect(mcpServers()).toEqual([expect.objectContaining({ url: fusionUrl })])
    expect(readMcpServersSnapshot()?.data).toEqual([
      expect.objectContaining({ url: fusionUrl }),
    ])
  })

  test('Pasting http://localhost:27182/mcp is rewritten to http://127.0.0.1:27182/mcp before connect', () => {
    expect(rewriteMcpLoopbackUrl(localhostUrl)).toBe(fusionUrl)
    expect(rewriteMcpLoopbackUrl(fusionUrl)).toBe(fusionUrl)
    mcpServers.set([{ id: 'fusion', url: rewriteMcpLoopbackUrl(localhostUrl) }])
    expect(mcpServers()[0]?.url).toBe(fusionUrl)
  })

  test('A stored localhost Fusion URL is rewritten to 127.0.0.1 after reload', () => {
    mcpServers.set([{ id: 'fusion', url: localhostUrl }])
    expect(readMcpServersSnapshot()?.data).toEqual([
      expect.objectContaining({ url: localhostUrl }),
    ])
    context.reset()
    expect(mcpServers()[0]?.url).toBe(fusionUrl)
  })

  test('Server list survives reload in localStorage prefs, not IndexedDB. Turning the chip off does not delete the saved server.', async () => {
    mcpServers.set([fusionServer])
    expect(readMcpServersSnapshot()?.data).toEqual([
      expect.objectContaining({ url: fusionUrl }),
    ])
    expect(createDefaultChatSettings().mcpEnabled).toBe(false)
    expect(mcpServers()).toEqual([expect.objectContaining({ url: fusionUrl })])

    await initStorage()
    expect(await atelierStoreNames()).not.toContain('mcpServers')
    context.reset()
    expect(mcpServers()).toEqual([expect.objectContaining({ url: fusionUrl })])
  })

  test('She can edit or delete a bad saved URL and try again', () => {
    mcpServers.set([{ id: 'fusion', url: 'http://127.0.0.1:9999/mcp' }])
    mcpServers.set([fusionServer])
    expect(mcpServers()).toEqual([expect.objectContaining({ url: fusionUrl })])
    expect(readMcpServersSnapshot()?.data).toEqual([
      expect.objectContaining({ url: fusionUrl }),
    ])
    mcpServers.set([])
    expect(mcpServers()).toEqual([])
    expect(readMcpServersSnapshot()?.data).toEqual([])
  })

  test('Settings includes an mcp section so Maya can paste any Streamable HTTP URL', () => {
    expect(appSettingsSectionIds).toContain('mcp')
    const section: AppSettingsSection = 'mcp'
    expect(section).toBe('mcp')
  })
})

describe('F-32 Fusion unreachable', () => {
  test('A saved Fusion URL is kept so she can Reconnect or re-paste if the port is stale', () => {
    const stalePort = 'http://127.0.0.1:27183/mcp'
    mcpServers.set([{ id: 'fusion', url: stalePort }])
    expect(readMcpServersSnapshot()?.data).toEqual([
      expect.objectContaining({ url: stalePort }),
    ])
    mcpServers.set([fusionServer])
    expect(readMcpServersSnapshot()?.data).toEqual([
      expect.objectContaining({ url: fusionUrl }),
    ])
  })
})

describe('F-35 First Fusion ask, not connected', () => {
  test('No Fusion server is saved by default; the chip is off until she pastes the URL', () => {
    expect(mcpServers()).toEqual([])
    expect(readMcpServersSnapshot()).toBeNull()
    expect(createDefaultChatSettings().mcpEnabled).toBe(false)
  })
})

describe('F-39 Refresh mid-Allow', () => {
  test('Saved Fusion URL is still in prefs after a chat write so a refresh can restore a waiting card, not auto-run', async () => {
    mcpServers.set([fusionServer])
    await initStorage()
    await repo.createChat(createChatRecord({ id: 'chat-fusion', at: 1 }))
    expect(readMcpServersSnapshot()?.data).toEqual([
      expect.objectContaining({ url: fusionUrl }),
    ])
    expect(await atelierStoreNames()).not.toContain('mcpServers')
  })
})
