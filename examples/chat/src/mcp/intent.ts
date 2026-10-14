import { humanToolName } from './names'

const asRecord = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const parseArguments = (raw: string) => {
  try {
    return asRecord(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

const scriptFrom = (args: Record<string, unknown>) => {
  if (typeof args.code === 'string') return args.code
  if (typeof args.script === 'string') return args.script
  const nested = asRecord(args.object)
  if (!nested) return ''
  if (typeof nested.script === 'string') return nested.script
  if (typeof nested.code === 'string') return nested.code
  return ''
}

const cubeIntent = (script: string) => {
  const match = script.match(
    /cube\s*\(\s*(\d+(?:\.\d+)?)\s*(?:,\s*["']?([^"')\s,]+))?/i,
  )
  if (!match) return null
  const size = match[1]
  const unit = match[2] ?? 'mm'
  return `Create a ${size} ${unit} cube on the open design.`
}

const extrudeIntent = (script: string) => {
  const match = script.match(/extrude[^\d]*(\d+(?:\.\d+)?)/i)
  if (!match) return null
  return `Extrude the sketch ${match[1]} mm on the open design.`
}

const exportIntent = (script: string) => {
  if (!/export|\.step/i.test(script)) return null
  if (/desktop/i.test(script)) return 'Export STEP to Desktop.'
  return 'Export STEP from the open design.'
}

const parameterIntent = (args: Record<string, unknown>) => {
  const name = typeof args.name === 'string' ? args.name.trim() : ''
  const value =
    typeof args.value === 'string'
      ? args.value.trim()
      : typeof args.value === 'number'
        ? String(args.value)
        : ''
  if (!name || !value) return null
  return `Set ${name} to ${value} on the open design.`
}

export const summariseToolArguments = (raw: string) => {
  const args = parseArguments(raw)
  if (!args) return null
  const parameter = parameterIntent(args)
  if (parameter) return parameter
  const script = scriptFrom(args)
  if (script.length > 0) {
    const cube = cubeIntent(script)
    if (cube) return cube
    const extrude = extrudeIntent(script)
    if (extrude) return extrude
    const exported = exportIntent(script)
    if (exported) return exported
  }
  return null
}

const listedDescription = (
  callName: string,
  listed?: readonly { name: string; description?: string }[],
) => {
  if (!listed || listed.length === 0) return null
  const human = humanToolName(callName)
  const match = listed.find(
    (tool) => tool.name === callName || humanToolName(tool.name) === human,
  )
  const description = match?.description?.trim()
  return description && description.length > 0 ? description : null
}

export const toolCallIntent = (
  call: { name: string; arguments: string },
  listed?: readonly { name: string; description?: string }[],
) => {
  const fromArgs = summariseToolArguments(call.arguments)
  if (fromArgs) return fromArgs
  const description = listedDescription(call.name, listed)
  if (description) return description
  const human = humanToolName(call.name)
  return `This ${human} will run on the connected server.`
}

export const parseToolResult = (raw: string | undefined) => {
  if (!raw || raw.length === 0) return { text: '', images: [] as string[] }
  try {
    const parsed = JSON.parse(raw) as unknown
    const record = asRecord(parsed)
    if (record && (typeof record.text === 'string' || Array.isArray(record.images))) {
      const images = Array.isArray(record.images)
        ? record.images.filter(
            (item): item is string => typeof item === 'string' && item.length > 0,
          )
        : []
      return {
        text: typeof record.text === 'string' ? record.text : '',
        images,
      }
    }
  } catch {
    // plain tool text
  }
  return { text: raw, images: [] as string[] }
}

export const serializeToolResult = (result: {
  text: string
  images?: readonly string[]
}) => {
  const images = result.images?.filter((item) => item.length > 0) ?? []
  if (images.length === 0) return result.text
  return JSON.stringify({ text: result.text, images })
}
