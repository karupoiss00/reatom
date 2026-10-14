import { describe, expect, test } from 'vitest'

import {
  isMcpWriteTool,
  mcpAlwaysAllows,
  rememberMcpAlwaysAllow,
} from './busy'
import { fusionToolNames } from '../testing/fixtures/mcp'

describe('P5 Always hunt on execute (F-31)', () => {
  test('Execute-class MCP names are writes; Always cannot remember them', () => {
    expect(isMcpWriteTool(fusionToolNames.execute)).toBe(true)
    expect(isMcpWriteTool(fusionToolNames.update)).toBe(true)
    expect(isMcpWriteTool('vendor_mcp_export')).toBe(true)
    expect(isMcpWriteTool(fusionToolNames.read)).toBe(false)
    rememberMcpAlwaysAllow(fusionToolNames.execute)
    expect(mcpAlwaysAllows(fusionToolNames.execute)).toBe(false)
  })

  test('Generic mutating MCP names are writes so Always cannot auto-run them', () => {
    expect(isMcpWriteTool('acme_mcp_apply')).toBe(true)
    expect(isMcpWriteTool('browser_mcp_click')).toBe(true)
    expect(isMcpWriteTool('shell_mcp_run')).toBe(true)
    rememberMcpAlwaysAllow('acme_mcp_apply')
    expect(mcpAlwaysAllows('acme_mcp_apply')).toBe(false)
  })
})
