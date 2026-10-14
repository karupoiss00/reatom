import { describe, expect, test } from 'vitest'

import {
  cubeExecuteArguments,
  cubeToolCallScript,
  fusionToolNames,
} from '../../testing/fixtures/mcp'
import { chunkToEvents } from '../parse'

describe('F-30 Rule Fusion from chat', () => {
  test('parse.ts emits tool_calls StreamEvents from Fusion execute chunks', () => {
    const events = cubeToolCallScript.flatMap((chunk) =>
      chunkToEvents(chunk.data),
    )
    expect(events).toContainEqual({
      kind: 'tool_calls',
      calls: [
        {
          id: 'call_fusion_cube',
          name: fusionToolNames.execute,
          arguments: cubeExecuteArguments,
        },
      ],
    })
    expect(events).toContainEqual({ kind: 'finish', reason: 'tool_calls' })
    expect(events.some((event) => event.kind === 'content')).toBe(false)
  })

  test('reads camelCase toolCalls the same way', () => {
    const events = chunkToEvents({
      choices: [
        {
          delta: {
            toolCalls: [
              {
                index: 0,
                id: 'call_fusion_read',
                type: 'function',
                function: {
                  name: fusionToolNames.read,
                  arguments: '{}',
                },
              },
            ],
          },
        },
      ],
    })
    expect(events).toContainEqual({
      kind: 'tool_calls',
      calls: [
        {
          id: 'call_fusion_read',
          name: fusionToolNames.read,
          arguments: '{}',
        },
      ],
    })
  })
})
