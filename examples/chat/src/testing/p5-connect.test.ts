import { expect, test } from 'vitest'

import {
  mcpCorsSentence,
  mcpInvalidUrlSentence,
  mcpPortSentence,
  mcpRequiredUrlSentence,
  mcpSchemeSentence,
  mcpUnreachableSentence,
  mcpUrlTooLongSentence,
} from '../errors/copy'
import {
  connectMcp,
  exampleMcpUrl,
  inspectMcpUrl,
  mcpError,
  mcpServers,
  mcpUrlDraft,
  mcpUrlMaxLength,
} from '../mcp'
import { fusionMcpUrl, fusionMcpWrongPortUrl } from './fixtures/mcp'
import {
  mcpRequests,
  simulateMcpCorsFail,
  simulateMcpWrongPort,
} from './mcp-mock'
import { externalRequests } from './openrouter-mock'

const savedSnapshot = () => localStorage.getItem('atelier.mcpServers') ?? ''

const fetchedSchemes = () =>
  [...mcpRequests(), ...externalRequests()].map((entry) => entry.url)

test('T-014 empty and whitespace Connect must not persist the example URL', async () => {
  expect(inspectMcpUrl('')).toEqual({ ok: false, problem: 'required' })
  expect(inspectMcpUrl(' \n\t ')).toEqual({ ok: false, problem: 'required' })

  await connectMcp('   ')
  expect(mcpError()).toBe(mcpRequiredUrlSentence)
  expect(mcpServers()).toEqual([])
  expect(savedSnapshot()).not.toContain(exampleMcpUrl)
  expect(mcpRequests()).toHaveLength(0)

  mcpUrlDraft.set('')
  await connectMcp()
  expect(mcpError()).toBe(mcpRequiredUrlSentence)
  expect(mcpServers()).toEqual([])
  expect(savedSnapshot()).not.toContain(exampleMcpUrl)
  expect(mcpRequests()).toHaveLength(0)
})

test('T-015 javascript, data, and file URLs are refused and never fetched', async () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///tmp/mcp',
  ]) {
    await connectMcp(url)
    expect(mcpError()).toBe(mcpSchemeSentence)
    expect(mcpServers()).toEqual([])
    expect(savedSnapshot()).not.toMatch(/javascript:|data:|file:/)
    expect(fetchedSchemes().some((fetched) => fetched.startsWith(url))).toBe(
      false,
    )
  }
  await connectMcp('npx @modelcontextprotocol/server')
  expect(mcpError()).toBe(mcpInvalidUrlSentence)
  expect(mcpServers()).toEqual([])
  expect(mcpRequests()).toHaveLength(0)
})

test('T-016 URLs over 2048 characters are rejected', async () => {
  const huge = `http://127.0.0.1:27182/mcp?q=${'x'.repeat(20_000)}`
  expect(huge.length).toBeGreaterThan(mcpUrlMaxLength)
  expect(inspectMcpUrl(huge)).toEqual({ ok: false, problem: 'too-long' })

  await connectMcp(huge)
  expect(mcpError()).toBe(mcpUrlTooLongSentence)
  expect(mcpServers()).toEqual([])
  expect(savedSnapshot()).not.toContain('x'.repeat(1000))
  expect(mcpRequests()).toHaveLength(0)

  const prefix = 'http://example.com/'
  const exact = `${prefix}${'a'.repeat(mcpUrlMaxLength - prefix.length)}`
  expect(inspectMcpUrl(exact).ok).toBe(true)
})

test('T-017 failed fetch is generic unreachable unless it is CORS or the example port mismatch', async () => {
  await connectMcp('http://example.invalid:9')
  expect(mcpError()).toBe(mcpUnreachableSentence)
  expect(mcpError()).not.toMatch(/browser blocked/i)

  simulateMcpCorsFail()
  await connectMcp(fusionMcpUrl)
  expect(mcpError()).toBe(mcpCorsSentence)

  simulateMcpWrongPort()
  await connectMcp(fusionMcpWrongPortUrl)
  expect(mcpError()).toBe(mcpPortSentence)
  expect(mcpError()).not.toBe(mcpCorsSentence)
})
