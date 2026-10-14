import { describe, expect, test } from 'vitest'

import { toolCallIntent } from './intent'
import { fusionMcpTools, fusionToolNames } from '../testing/fixtures/mcp'

describe('P5 generic MCP intent (F-30)', () => {
  test('Very long execute args stay a short intent, not the blob', () => {
    const argumentsJson = JSON.stringify({
      code: `${'x'.repeat(24_000)}\nprint("noop")`,
    })
    const intent = toolCallIntent(
      { name: fusionToolNames.execute, arguments: argumentsJson },
      fusionMcpTools,
    )
    expect(intent.length).toBeLessThan(400)
    expect(intent).not.toContain('x'.repeat(80))
    expect(intent).not.toMatch(/with the arguments below/i)
  })

  test('Generic MCP writes do not fall back to Fusion design copy', () => {
    const intent = toolCallIntent({
      name: 'acme_mcp_apply',
      arguments: JSON.stringify({ patch: 'x'.repeat(4000) }),
    })
    expect(intent).not.toMatch(/open design/i)
    expect(intent).not.toMatch(/Fusion/i)
    expect(intent.length).toBeLessThan(400)
  })
})
