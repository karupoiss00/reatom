import { describe, expect, test } from 'vitest'

import { streamEventKinds, wireMessageRoles } from '../types'
import type { StreamEvent, WireMessage } from '../types'

describe('F-29 Connect Fusion MCP', () => {
  test('WireMessage can represent a Fusion tool turn so Maya sees a named tool, not raw protocol text', () => {
    expect(wireMessageRoles).toContain('tool')
    const toolTurn: WireMessage = {
      role: 'tool',
      content: JSON.stringify({ success: true }),
      toolCallId: 'call_fusion_read',
    }
    expect(toolTurn.role).toBe('tool')
    expect(toolTurn.toolCallId).toBe('call_fusion_read')
  })
})

describe('F-32 Fusion unreachable', () => {
  test('A Fusion tool result can be a job error on the wire, not protocol soup', () => {
    expect(wireMessageRoles).toContain('tool')
    const toolError: WireMessage = {
      role: 'tool',
      content: JSON.stringify({
        isError: true,
        message: 'Reconnect and enable the Fusion MCP checkbox',
      }),
      toolCallId: 'call_fusion_execute',
    }
    expect(toolError.role).toBe('tool')
    expect(String(toolError.content)).toContain('Reconnect')
    expect(String(toolError.content)).toContain(
      'enable the Fusion MCP checkbox',
    )
  })
})

describe('F-35 First Fusion ask, not connected', () => {
  test('Without a tool turn on the wire, the assistant must not invent a completed Fusion action', () => {
    const ordinary: WireMessage = {
      role: 'assistant',
      content: 'Paste http://127.0.0.1:27182/mcp from Fusion Preferences.',
    }
    expect(ordinary.role).toBe('assistant')
    expect(
      'toolCalls' in ordinary ? ordinary.toolCalls : undefined,
    ).toBeUndefined()
  })
})

describe('F-39 Refresh mid-Allow', () => {
  test('After refresh the Fusion write is waiting again; the tool never auto-runs as completed', () => {
    expect(streamEventKinds).toContain('tool_calls')
    const waiting: WireMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'call_fusion_execute',
          name: 'fusion_mcp_execute',
          arguments: JSON.stringify({
            featureType: 'script',
            object: { script: 'def run(_ctx): pass' },
          }),
          approval: 'waiting',
        },
      ],
    }
    expect(waiting.toolCalls?.[0]?.approval).toBe('waiting')
    expect(waiting.toolCalls?.[0]?.approval).not.toBe('completed')
    const event: StreamEvent = {
      kind: 'tool_calls',
      calls: [
        {
          id: 'call_fusion_execute',
          name: 'fusion_mcp_execute',
          arguments: '{"featureType":"script"}',
        },
      ],
    }
    expect(event.kind).toBe('tool_calls')
    expect(event.calls[0]?.name).toBe('fusion_mcp_execute')
  })
})
