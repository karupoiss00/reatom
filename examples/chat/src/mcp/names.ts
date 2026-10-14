export const defaultServerDisplayName = 'MCP'

const mcpToolPrefix = /^[\w-]+_mcp_/i

export const humanToolName = (name: string) => {
  const stripped = name.replace(mcpToolPrefix, '').replace(/_/g, ' ').trim()
  return stripped.length > 0 ? stripped : name
}

export const serverDisplayName = (name?: string) => {
  const trimmed = name?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : defaultServerDisplayName
}
