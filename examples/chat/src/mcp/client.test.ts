import { expect, test } from 'vitest'

import { mcpEmptyToolsSentence, mcpUnreachableSentence } from '../errors/copy'
import { simulateMcpHtmlFail, simulateMcpRpcError } from '../testing/mcp-mock'
import { connectMcp, mcpError, mcpReady, mcpTools } from './index'
import { fusionMcpUrl } from './url'

const connectAndRead = async () => {
  await connectMcp(fusionMcpUrl)
  return {
    ready: mcpReady(),
    tools: mcpTools(),
    error: mcpError(),
  }
}

test('HTML 5xx is unreachable, not an empty tool list', async () => {
  simulateMcpHtmlFail()
  const result = await connectAndRead()
  expect(result.ready).toBe(false)
  expect(result.tools).toEqual([])
  expect(result.error).toBe(mcpUnreachableSentence)
  expect(result.error).not.toBe(mcpEmptyToolsSentence)
  expect(result.error).not.toMatch(
    /not ready|html|bad gateway|browser blocked/i,
  )
})

test('json-rpc error.message is remapped to unreachable copy, not shown in the banner', async () => {
  const leaked = 'json-rpc internal: stack dump'
  simulateMcpRpcError(leaked)
  const result = await connectAndRead()
  expect(result.ready).toBe(false)
  expect(result.error).toBe(mcpUnreachableSentence)
  expect(result.error).not.toContain(leaked)
  expect(result.error).not.toMatch(/json-rpc|stack dump/i)
})
