export type CapturedOpenRouterRequest = {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

export type MockStatus = {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

export type MockDataChunk = {
  delayMs?: number
  data: object
}

export type MockCommentChunk = {
  comment: true
  delayMs?: number
}

export type MockChatChunk = MockDataChunk | MockCommentChunk

export type MockStreamScript = {
  chunks?: readonly MockChatChunk[]
  hang?: boolean
  networkError?: boolean
  headers?: Record<string, string>
  firstTokenDelayMs?: number
}

export type MockChatScript =
  | readonly MockChatChunk[]
  | MockStatus
  | MockStreamScript

const apiOrigin = 'https://openrouter.ai/api/v1'

const routes = {
  models: '/api/v1/models',
  key: '/api/v1/key',
  chat: '/api/v1/chat/completions',
  generation: '/api/v1/generation',
  auth: '/api/v1/auth/keys',
  providers: '/api/v1/providers',
} as const

let nativeFetch: typeof fetch | undefined
let installed = false
let generation = 0
let generationController = new AbortController()
let captures: CapturedOpenRouterRequest[] = []
let externalCaptures: CapturedOpenRouterRequest[] = []
let externalAllow: ((url: URL) => boolean) | undefined
let modelsList: readonly object[] | undefined
let keyResponse: object | MockStatus | undefined
let chatScript: MockChatScript | undefined
let chatQueue: MockChatScript[] = []
let chatByModel = new Map<string, MockChatScript>()
let generationResponse: object | MockStatus | undefined
let authExchange: object | MockStatus | undefined
let providersResponse: readonly object[] | MockStatus | undefined
let routeDelays = new Map<string, number>()

const abortError = () =>
  new DOMException('The operation was aborted.', 'AbortError')

const isCurrent = (gen: number) => gen === generation

const isMockStatus = (value: object): value is MockStatus =>
  'status' in value &&
  typeof (value as { status: unknown }).status === 'number'

const isChunkList = (
  script: MockChatScript,
): script is readonly MockChatChunk[] => Array.isArray(script)

const isStreamScript = (
  script: MockStatus | MockStreamScript,
): script is MockStreamScript =>
  'networkError' in script ||
  'chunks' in script ||
  'hang' in script ||
  'firstTokenDelayMs' in script

const isDataChunk = (chunk: MockChatChunk): chunk is MockDataChunk =>
  'data' in chunk

const isCommentChunk = (chunk: MockChatChunk): chunk is MockCommentChunk =>
  'comment' in chunk && chunk.comment === true

const headerRecord = (headers: Headers): Record<string, string> => {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

const matchPath = (pathname: string, path: string) => {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return pathname === suffix || pathname.endsWith(suffix)
}

const delayFor = (pathname: string) => {
  for (const [path, delayMs] of routeDelays) {
    if (matchPath(pathname, path)) return delayMs
  }
  return 0
}

const requestModel = (body: unknown) => {
  if (!body || typeof body !== 'object' || !('model' in body)) return undefined
  const model = (body as { model: unknown }).model
  return typeof model === 'string' ? model : undefined
}

const takeChatScript = (model: string | undefined) => {
  if (chatQueue.length > 0) return chatQueue.shift()
  if (model && chatByModel.has(model)) return chatByModel.get(model)
  return chatScript
}

const errorBody = (status: number, body?: unknown) => {
  if (body !== undefined) return body
  return {
    error: {
      code: status,
      message:
        status === 401
          ? 'No cookie auth credentials found'
          : 'OpenRouter mock error',
    },
  }
}

const jsonResponse = (
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      ...headers,
    },
  })

const statusResponse = (status: MockStatus) =>
  jsonResponse(errorBody(status.status, status.body), status.status, status.headers)

const wait = (delayMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const generationSignal = generationController.signal
    if (signal.aborted || generationSignal.aborted) {
      reject(abortError())
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', fail)
      generationSignal.removeEventListener('abort', fail)
      if (signal.aborted || generationSignal.aborted) reject(abortError())
      else resolve()
    }, delayMs)
    const fail = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', fail)
      generationSignal.removeEventListener('abort', fail)
      reject(abortError())
    }
    signal.addEventListener('abort', fail, { once: true })
    generationSignal.addEventListener('abort', fail, { once: true })
  })

const chunkId = (chunks: readonly MockChatChunk[]) => {
  for (const chunk of chunks) {
    if (!isDataChunk(chunk)) continue
    const id = (chunk.data as { id?: unknown }).id
    if (typeof id === 'string') return id
  }
  return undefined
}

const sseHeaders = (
  chunks: readonly MockChatChunk[],
  extra?: Record<string, string>,
) => {
  const id = chunkId(chunks)
  return {
    ...extra,
    ...(id ? { 'X-Generation-Id': id } : {}),
    'content-type': 'text/event-stream',
    'access-control-allow-origin': '*',
  }
}

const sseBody = (chunks: readonly MockChatChunk[]) => {
  const frames = [': OPENROUTER PROCESSING', '']
  for (const chunk of chunks) {
    if (isCommentChunk(chunk)) {
      frames.push(': OPENROUTER PROCESSING', '')
      continue
    }
    frames.push(`data: ${JSON.stringify(chunk.data)}`, '')
  }
  frames.push('data: [DONE]', '')
  return `${frames.join('\n')}\n`
}

const untilAbort = (signal: AbortSignal) =>
  new Promise<void>((_, reject) => {
    const generationSignal = generationController.signal
    if (signal.aborted || generationSignal.aborted) {
      reject(abortError())
      return
    }
    const fail = () => reject(abortError())
    signal.addEventListener('abort', fail, { once: true })
    generationSignal.addEventListener('abort', fail, { once: true })
  })

const needsLiveStream = (
  chunks: readonly MockChatChunk[],
  options?: { hang?: boolean; firstTokenDelayMs?: number },
) =>
  Boolean(options?.hang) ||
  (options?.firstTokenDelayMs ?? 0) > 0 ||
  chunks.some((chunk) => (chunk.delayMs ?? 0) > 0)

const sseResponse = async (
  chunks: readonly MockChatChunk[],
  signal: AbortSignal,
  options?: {
    hang?: boolean
    headers?: Record<string, string>
    firstTokenDelayMs?: number
  },
) => {
  const headers = sseHeaders(chunks, options?.headers)
  if (!needsLiveStream(chunks, options)) {
    return new Response(sseBody(chunks), { status: 200, headers })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(': OPENROUTER PROCESSING\n\n'))
        if (options?.firstTokenDelayMs) {
          await wait(options.firstTokenDelayMs, signal)
        }
        for (const chunk of chunks) {
          if (signal.aborted || generationController.signal.aborted) {
            throw abortError()
          }
          if (isCommentChunk(chunk)) {
            if (chunk.delayMs) await wait(chunk.delayMs, signal)
            controller.enqueue(encoder.encode(': OPENROUTER PROCESSING\n\n'))
            continue
          }
          if (chunk.delayMs) await wait(chunk.delayMs, signal)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(chunk.data)}\n\n`),
          )
        }
        if (options?.hang) await untilAbort(signal)
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
  return new Response(stream, { status: 200, headers })
}

const playStream = async (
  chunks: readonly MockChatChunk[],
  signal: AbortSignal,
  options?: {
    hang?: boolean
    headers?: Record<string, string>
    firstTokenDelayMs?: number
  },
) => {
  const [first, ...rest] = chunks
  if (first && isDataChunk(first) && first.delayMs) {
    await wait(first.delayMs, signal)
    return sseResponse([{ ...first, delayMs: 0 }, ...rest], signal, options)
  }
  return sseResponse(chunks, signal, options)
}

const readBody = async (request: Request): Promise<unknown> => {
  const text = await request.clone().text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

const fulfillChat = async (script: MockChatScript, request: Request) => {
  if (isChunkList(script)) return playStream(script, request.signal)
  if (isStreamScript(script)) {
    if (script.networkError) throw new TypeError('Failed to fetch')
    return playStream(script.chunks ?? [], request.signal, {
      hang: script.hang === true,
      headers: script.headers,
      firstTokenDelayMs: script.firstTokenDelayMs,
    })
  }
  return statusResponse(script)
}

const fulfill = async (
  request: Request,
  body: unknown,
  gen: number,
): Promise<Response> => {
  const url = new URL(request.url)
  const delayMs = delayFor(url.pathname)
  if (delayMs > 0) await wait(delayMs, request.signal)
  if (!isCurrent(gen)) throw abortError()
  if (url.pathname === routes.models) {
    const list = modelsList ?? []
    return jsonResponse({
      data: list,
      total_count: list.length,
      links: { next: null },
    })
  }
  if (url.pathname === routes.key) {
    if (!keyResponse) return jsonResponse(errorBody(404), 404)
    if (isMockStatus(keyResponse)) return statusResponse(keyResponse)
    return jsonResponse({ data: keyResponse })
  }
  if (url.pathname === routes.chat) {
    const script = takeChatScript(requestModel(body))
    if (!script) return jsonResponse(errorBody(404), 404)
    return fulfillChat(script, request)
  }
  if (url.pathname === routes.generation) {
    if (!generationResponse) return jsonResponse(errorBody(404), 404)
    if (isMockStatus(generationResponse)) return statusResponse(generationResponse)
    return jsonResponse({ data: generationResponse })
  }
  if (url.pathname === routes.auth) {
    if (!authExchange) return jsonResponse(errorBody(404), 404)
    if (isMockStatus(authExchange)) return statusResponse(authExchange)
    return jsonResponse(authExchange)
  }
  if (url.pathname === routes.providers) {
    if (!providersResponse) return jsonResponse(errorBody(404), 404)
    if (isMockStatus(providersResponse)) return statusResponse(providersResponse)
    return jsonResponse({ data: providersResponse })
  }
  return jsonResponse(errorBody(404), 404)
}

const passesThrough = (url: URL) =>
  url.origin === globalThis.location.origin || externalAllow?.(url) === true

const mockedFetch: typeof fetch = async (input, init) => {
  const gen = generation
  const request =
    input instanceof Request && init == null ? input : new Request(input, init)
  const url = new URL(request.url)
  if (!url.href.startsWith(apiOrigin)) {
    if (!isCurrent(gen)) throw abortError()
    externalCaptures.push({
      url: request.url,
      method: request.method,
      headers: headerRecord(request.headers),
      body: undefined,
    })
    if (passesThrough(url)) {
      if (!nativeFetch) throw new Error('OpenRouter mock is not installed')
      return nativeFetch(input, init)
    }
    throw new TypeError('blocked by test mock')
  }
  if (request.signal.aborted || !isCurrent(gen)) throw abortError()
  const body = await readBody(request)
  if (request.signal.aborted || !isCurrent(gen)) throw abortError()
  captures.push({
    url: request.url,
    method: request.method,
    headers: headerRecord(request.headers),
    body,
  })
  if (!isCurrent(gen)) throw abortError()
  return fulfill(request, body, gen)
}

export const installOpenRouterMock = () => {
  if (installed) return
  nativeFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = mockedFetch
  installed = true
}

export const uninstallOpenRouterMock = () => {
  if (!installed || !nativeFetch) return
  globalThis.fetch = nativeFetch
  nativeFetch = undefined
  installed = false
}

export const resetOpenRouterMock = () => {
  generation += 1
  generationController.abort()
  generationController = new AbortController()
  captures = []
  externalCaptures = []
  externalAllow = undefined
  modelsList = undefined
  keyResponse = undefined
  chatScript = undefined
  chatQueue = []
  chatByModel = new Map()
  generationResponse = undefined
  authExchange = undefined
  providersResponse = undefined
  routeDelays = new Map()
}

export const openRouterRequests = (): readonly CapturedOpenRouterRequest[] =>
  captures

export const externalRequests = (): readonly CapturedOpenRouterRequest[] =>
  externalCaptures

export const allowExternalPassthrough = (match: (url: URL) => boolean) => {
  externalAllow = match
}

export const requestsTo = (
  path: string,
): readonly CapturedOpenRouterRequest[] =>
  captures.filter((entry) => matchPath(new URL(entry.url).pathname, path))

export const chatBodies = (): readonly unknown[] =>
  requestsTo(routes.chat).map((entry) => entry.body)

export const mockModels = (list: readonly object[]) => {
  modelsList = list
}

export const mockKey = (meta: object | MockStatus) => {
  keyResponse = meta
}

export const mockChatStream = (script: MockChatScript) => {
  chatScript = script
}

export const mockChatStreams = (scripts: readonly MockChatScript[]) => {
  chatQueue = [...scripts]
}

export const mockChatStreamFor = (model: string, script: MockChatScript) => {
  chatByModel.set(model, script)
}

export const mockGeneration = (generationRecord: object | MockStatus) => {
  generationResponse = generationRecord
}

export const mockAuthExchange = (result: object | MockStatus) => {
  authExchange = result
}

export const mockProviders = (list: readonly object[] | MockStatus) => {
  providersResponse = list
}

export const mockRouteDelay = (path: string, delayMs: number) => {
  routeDelays.set(path, delayMs)
}
