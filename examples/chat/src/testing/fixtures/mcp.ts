export const fusionMcpPort = 27182
export const fusionMcpUrl = `http://127.0.0.1:${fusionMcpPort}/mcp`
export const fusionMcpLocalhostUrl = `http://localhost:${fusionMcpPort}/mcp`
export const fusionMcpWrongPortUrl = 'http://127.0.0.1:27183/mcp'
export const fusionMcpBlogUrl = 'http://127.0.0.1:27182/blog'

export const fusionServerName = 'Fusion'
export const fusionHumanToolNames = ['read', 'execute', 'update'] as const

export const fusionToolNames = {
  execute: 'fusion_mcp_execute',
  read: 'fusion_mcp_read',
  update: 'fusion_mcp_update',
} as const

export const reconnectCopy = 'Reconnect'
export const mcpChipLabel = 'MCP Server'
export const mcpServerRunningCopy = 'check the server is running'
export const fusionCheckboxCopy = 'enable the Fusion checkbox'
export const fusionPreferencesCopy = 'Preferences → General → API'
export const pasteUrlCta = fusionMcpUrl
export const allowOnceLabel = 'Allow once'
export const denyLabel = 'Deny'
export const callingMcp = 'Calling MCP'
export const mcpBusyCopy = `${mcpChipLabel} busy`
export const callingFusion = 'Calling Fusion…'
export const fusionBusy = 'Fusion busy'
export const cubeAsk = 'make a 10mm cube'
export const fusionCubeAsk = 'make a 10mm cube in Fusion'
export const widthAsk = 'set Width to 40 mm'
export const extrudeAsk = 'extrude that sketch 5 mm'
export const exportAsk = 'export STEP to Desktop'
export const undoAsk = 'undo'
export const nileAsk = 'Where does the Nile start?'

export type FusionMcpToolName =
  (typeof fusionToolNames)[keyof typeof fusionToolNames]

export type FusionMcpToolFixture = {
  name: FusionMcpToolName
  humanName: (typeof fusionHumanToolNames)[number]
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required: string[]
  }
}

export const fusionMcpTools: readonly FusionMcpToolFixture[] = [
  {
    name: fusionToolNames.read,
    humanName: 'read',
    description: 'Read the open document without changing it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional path or query inside the design.',
        },
      },
      required: [],
    },
  },
  {
    name: fusionToolNames.execute,
    humanName: 'execute',
    description: 'Run a script that changes the open document.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Python to run on the server.',
        },
      },
      required: ['code'],
    },
  },
  {
    name: fusionToolNames.update,
    humanName: 'update',
    description: 'Update a named parameter on the open design.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Parameter name.' },
        value: { type: 'string', description: 'New value, including units.' },
      },
      required: ['name', 'value'],
    },
  },
]

export const cubeExecuteCode = 'app.documents.add(); cube(10, "mm")'
export const cubeExecuteArguments = JSON.stringify({ code: cubeExecuteCode })
export const widthUpdateArguments = JSON.stringify({
  name: 'Width',
  value: '40 mm',
})
export const exportExecuteArguments = JSON.stringify({
  code: 'export_step("/Users/maya/Desktop/design.step")',
})

const toolCallScript = (
  id: string,
  name: string,
  args: string,
  callId: string,
) => [
  {
    data: {
      id,
      object: 'chat.completion.chunk',
      created: 1710000000,
      model: 'openai/gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: callId,
                type: 'function',
                function: { name, arguments: args },
              },
            ],
          },
          finish_reason: 'tool_calls' as const,
        },
      ],
    },
  },
]

const usage = {
  prompt_tokens: 12,
  completion_tokens: 8,
  total_tokens: 20,
  cost: 0.00002,
  is_byok: false,
  completion_tokens_details: { reasoning_tokens: 0 },
}

export const mcpPlainReplyScript = [
  {
    data: {
      id: 'gen-mcp-plain',
      object: 'chat.completion.chunk',
      created: 1710000000,
      model: 'openai/gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: { content: 'What would you like to do?' },
          finish_reason: 'stop' as const,
        },
      ],
      usage,
    },
  },
]

export const longExecuteArguments = JSON.stringify({
  code: `${'x'.repeat(8_000)}\nprint("noop")`,
})

export const cubeToolCallScript = toolCallScript(
  'gen-mcp-cube',
  fusionToolNames.execute,
  cubeExecuteArguments,
  'call_fusion_cube',
)

export const longToolCallScript = toolCallScript(
  'gen-mcp-long',
  fusionToolNames.execute,
  longExecuteArguments,
  'call_mcp_long',
)

export const widthToolCallScript = toolCallScript(
  'gen-mcp-width',
  fusionToolNames.update,
  widthUpdateArguments,
  'call_fusion_width',
)

export const exportToolCallScript = toolCallScript(
  'gen-mcp-export',
  fusionToolNames.execute,
  exportExecuteArguments,
  'call_fusion_export',
)

export const cubeFollowUpScript = [
  {
    data: {
      id: 'gen-mcp-cube-done',
      object: 'chat.completion.chunk',
      created: 1710000000,
      model: 'openai/gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: { content: 'The 10 mm cube is in the open Fusion design.' },
          finish_reason: 'stop' as const,
        },
      ],
      usage,
    },
  },
]

export const cubeDeniedFollowUpScript = [
  {
    data: {
      id: 'gen-mcp-cube-denied',
      object: 'chat.completion.chunk',
      created: 1710000000,
      model: 'openai/gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: {
            content: 'I did not run that Fusion execute. Want to try another way?',
          },
          finish_reason: 'stop' as const,
        },
      ],
      usage,
    },
  },
]

export const fusionQuitFollowUpScript = [
  {
    data: {
      id: 'gen-mcp-quit',
      object: 'chat.completion.chunk',
      created: 1710000000,
      model: 'openai/gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: {
            content:
              'Fusion stopped while that execute was running. Reconnect and enable the Fusion checkbox.',
          },
          finish_reason: 'stop' as const,
        },
      ],
      usage,
    },
  },
]
