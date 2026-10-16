import { catalogById, modelName } from '../catalog'
import type { CatalogModel } from '../catalog/types'
import { repo } from '../storage/repo'
import type {
  AttachmentRef,
  MessageRecord,
  PdfEngineLabel,
} from '../storage/types'
import { activeChat, sendBlockContributors } from './chatModel'
import type { ChatModel, SendBlock, SendBlockContributor } from './types'

export const acceptsImages = (model: CatalogModel | null): boolean =>
  model?.inputModalities.includes('image') ?? false

export const acceptsFiles = (model: CatalogModel | null): boolean =>
  model?.inputModalities.includes('file') ?? false

export type IncomingModality = 'image' | 'file'

export const suggestionLimit = 3

export const clipboardDeniedCopy = "Couldn't read the clipboard."

export const attachAgainCopy = 'Attach again'

export const incomingModality = (file: File): IncomingModality =>
  file.type.startsWith('image/') ? 'image' : 'file'

export const modelAcceptsModality = (
  model: CatalogModel | null,
  modality: IncomingModality,
): boolean =>
  modality === 'image' ? acceptsImages(model) : acceptsFiles(model)

export const attachmentSupported = (
  ref: AttachmentRef,
  model: CatalogModel | null,
): boolean =>
  ref.kind === 'image' ? acceptsImages(model) : acceptsFiles(model)

export const paperclipReason = (modelLabel: string) =>
  `${modelLabel} can't read images or files`

export const rejectionCopy = (
  modelLabel: string,
  modality: IncomingModality,
) =>
  modality === 'image'
    ? `${modelLabel} can't read images`
    : `${modelLabel} can't read files`

export const unsupportedSendLabel = (modelLabel: string) =>
  `Not supported by ${modelLabel}`

export const switchLabel = (modality: IncomingModality) =>
  modality === 'image'
    ? 'Switch to a vision model'
    : 'Switch to a model that reads files'

const modalityKey = (modality: IncomingModality) =>
  modality === 'image' ? 'image' : 'file'

export const modalitySuggestions = (
  models: readonly CatalogModel[],
  modality: IncomingModality,
  currentId: string | null,
  limit = suggestionLimit,
): CatalogModel[] => {
  const key = modalityKey(modality)
  const matches: CatalogModel[] = []
  for (const model of models) {
    if (model.id === currentId) continue
    if (!model.inputModalities.includes(key)) continue
    matches.push(model)
    if (matches.length === limit) break
  }
  return matches
}

export const filesFromTransfer = (
  data: DataTransfer | null,
): File[] | 'unreadable' | null => {
  if (!data) return null
  const direct = [...data.files]
  if (direct.length > 0) return direct
  const fileItems = [...data.items].filter((item) => item.kind === 'file')
  if (fileItems.length === 0) return null
  const extracted = fileItems
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
  if (extracted.length === 0) return 'unreadable'
  return extracted
}

export const filesFromClipboardItems = async (
  items: ClipboardItems,
): Promise<File[]> => {
  const files: File[] = []
  for (const item of items) {
    for (const type of item.types) {
      if (!type.startsWith('image/') && type !== 'application/pdf') continue
      const blob = await item.getType(type)
      const name = type === 'application/pdf' ? 'Pasted.pdf' : 'Pasted image'
      files.push(new File([blob], name, { type }))
    }
  }
  return files
}

export const unsupportedAttachmentBlock: SendBlockContributor = (
  chat: ChatModel,
): SendBlock | null => {
  const modelId = chat.model()
  if (!modelId) return null
  const model = catalogById().get(modelId) ?? null
  const blocked = chat.draft
    .attachments()
    .some((ref) => !attachmentSupported(ref, model))
  if (!blocked) return null
  return {
    code: 'unsupported-attachment',
    label: unsupportedSendLabel(modelName(modelId)),
  }
}

export const maxFileBytes = 10 * 1024 * 1024
export const maxMessageBytes = 20 * 1024 * 1024

export const dropToAttachCopy = 'Drop to attach'
export const attachmentsTooLargeCopy = 'Attachments too large'
export const encodingCopy = (name: string) => `Encoding ${name}`

export const unsupportedTypeCopy = (name: string) =>
  `${name}: only PNG, JPEG, WebP, GIF, or PDF`

const bytesPerMegabyte = 1024 * 1024

const wholeMegabytes = (size: number) => {
  const rounded = Math.round((size / bytesPerMegabyte) * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text} MB`
}

export const fileTooLargeCopy = (name: string, size: number) =>
  `${name} is ${wholeMegabytes(size)} (limit 10 MB)`

export const formatAttachmentSize = (size: number) => {
  if (size < 1024) return `${size} B`
  if (size < bytesPerMegabyte)
    return `${Math.max(1, Math.round(size / 1024))} KB`
  return wholeMegabytes(size)
}

const mimeByExtension: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
}

const allowedMimes = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'application/pdf',
])

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export type AcceptedAttachment = {
  ok: true
  kind: 'image' | 'pdf'
  mime: string
}

export type RejectedAttachment = { ok: false; reason: 'type' | 'size' }

export const classifyAttachmentFile = (
  file: File,
): AcceptedAttachment | RejectedAttachment => {
  const extension = extensionOf(file.name)
  const fromExtension = mimeByExtension[extension]
  if (extension !== '' && !fromExtension) return { ok: false, reason: 'type' }
  const rawMime = file.type.toLowerCase()
  const mime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime
  if (rawMime && !allowedMimes.has(rawMime) && !allowedMimes.has(mime)) {
    return { ok: false, reason: 'type' }
  }
  if (!fromExtension && !mime) return { ok: false, reason: 'type' }
  if (fromExtension && mime && mime !== fromExtension) {
    return { ok: false, reason: 'type' }
  }
  if (file.size > maxFileBytes) return { ok: false, reason: 'size' }
  const canonical = fromExtension ?? mime
  return {
    ok: true,
    kind: canonical === 'application/pdf' ? 'pdf' : 'image',
    mime: canonical,
  }
}

export const dataUrlWithMime = (dataUrl: string, mime: string) => {
  const comma = dataUrl.indexOf(',')
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : ''
  return `data:${mime};base64,${payload}`
}

export const countPdfPages = (source: string) => {
  const matches = source.match(/\/Type\s*\/Page(?!s)\b/g)
  if (!matches || matches.length === 0) return undefined
  return matches.length
}

export const pdfParserMenu = [
  {
    id: 'text' as const,
    label: 'Text extraction (free)',
    wire: 'cloudflare-ai',
  },
  { id: 'ocr' as const, label: 'OCR ($2 / 1,000 pages)', wire: 'mistral-ocr' },
  { id: 'native' as const, label: 'Native (billed as tokens)', wire: 'native' },
]

export const pdfWireEngine = (engine: PdfEngineLabel | undefined) =>
  pdfParserMenu.find((choice) => choice.id === (engine ?? 'text'))?.wire ??
  pdfParserMenu[0].wire

export const pdfParserLabel = (engine: PdfEngineLabel | undefined) =>
  pdfParserMenu.find((choice) => choice.id === (engine ?? 'text'))?.label ??
  pdfParserMenu[0].label

const pdfDataById = new Map<string, string>()
const pdfEngineByData = new Map<string, string>()

export const rememberPdf = (
  id: string,
  dataUrl: string,
  engine: PdfEngineLabel | undefined,
) => {
  pdfDataById.set(id, dataUrl)
  pdfEngineByData.set(dataUrl, pdfWireEngine(engine))
}

export const retargetPdfEngine = (id: string, engine: PdfEngineLabel) => {
  const dataUrl = pdfDataById.get(id)
  if (!dataUrl) return
  pdfEngineByData.set(dataUrl, pdfWireEngine(engine))
}

const fileDataUrls = (body: unknown) => {
  if (!body || typeof body !== 'object' || !('messages' in body)) return []
  const messages = (body as { messages?: unknown }).messages
  if (!Array.isArray(messages)) return []
  const urls: string[] = []
  for (const message of messages) {
    if (!message || typeof message !== 'object' || !('content' in message))
      continue
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const record = part as {
        type?: unknown
        file?: { file_data?: unknown; fileData?: unknown }
      }
      if (record.type !== 'file') continue
      const data = record.file?.file_data ?? record.file?.fileData
      if (typeof data === 'string' && data.startsWith('data:application/pdf')) {
        urls.push(data)
      }
    }
  }
  return urls
}

const engineFromLoadedMessages = async (dataUrl: string) => {
  let messages: Iterable<MessageRecord>
  try {
    messages = activeChat().messages().values()
  } catch {
    return null
  }
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const ref of message.attachments) {
      if (ref.kind !== 'pdf') continue
      const blob = await repo.getAttachment(ref.id).catch(() => undefined)
      if (blob?.dataUrl !== dataUrl) continue
      return pdfWireEngine(ref.pdfEngine)
    }
  }
  return null
}

const engineForRequest = async (body: unknown) => {
  const urls = fileDataUrls(body)
  if (urls.length === 0) return null
  let engine: string | null = null
  for (const url of urls) {
    engine =
      pdfEngineByData.get(url) ??
      (await engineFromLoadedMessages(url)) ??
      engine
  }
  return engine ?? pdfWireEngine('text')
}

const requestUrl = (input: RequestInfo | URL) => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

const enrichChatBody = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = requestUrl(input)
  const method = (
    init?.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase()
  if (method !== 'POST' || !url.includes('/chat/completions'))
    return { input, init }
  const request =
    input instanceof Request && init == null ? input : new Request(input, init)
  const raw = await request.clone().text()
  if (!raw) return { input: request, init: undefined }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return { input: request, init: undefined }
  }
  const engine = await engineForRequest(parsed)
  if (!engine || !parsed || typeof parsed !== 'object') {
    return { input: request, init: undefined }
  }
  const next = { ...(parsed as Record<string, unknown>) }
  const current = Array.isArray(next.plugins) ? next.plugins : []
  const rest = current.filter((plugin) => {
    if (!plugin || typeof plugin !== 'object') return true
    return (plugin as { id?: unknown }).id !== 'file-parser'
  })
  next.plugins = [...rest, { id: 'file-parser', pdf: { engine } }]
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  return {
    input: new Request(request, { body: JSON.stringify(next), headers }),
    init: undefined,
  }
}

let bridgedFetch: typeof fetch | null = null

// request.ts is outside this task, so the file-parser plugin is added on the wire.
export const ensureFileParserBridge = () => {
  if (globalThis.fetch === bridgedFetch) return
  const inner = globalThis.fetch.bind(globalThis)
  const bridged: typeof fetch = async (input, init) => {
    let enriched: { input: RequestInfo | URL; init?: RequestInit }
    try {
      enriched = await enrichChatBody(input, init)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError')
        throw error
      return inner(input, init)
    }
    return inner(enriched.input, enriched.init)
  }
  bridgedFetch = bridged
  globalThis.fetch = bridged
}

let guardRegistered = false

export const ensureAttachmentGuard = () => {
  if (guardRegistered) return
  guardRegistered = true
  sendBlockContributors.register(unsupportedAttachmentBlock)
}
