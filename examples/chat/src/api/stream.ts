import { HTTPClient } from '@openrouter/sdk'
import type { ChatRequest, ChatStreamChunk } from '@openrouter/sdk/models'
import { atom } from '@reatom/core'

import { apiKey } from '../auth/keyStore'
import { createOpenRouterClient } from './client'

export type RawStreamChunk = Record<string, unknown>

export interface StreamItem {
  chunk: ChatStreamChunk
  raw: RawStreamChunk | undefined
  headers: Headers | null
}

interface RawFrameQueue {
  next(): Promise<RawStreamChunk | undefined>
  cancel(): void
}

const isEventStream = (response: Response) =>
  (response.headers.get('content-type') ?? '').includes('text/event-stream')

const parseFrame = (frame: string): RawStreamChunk | 'done' | null => {
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue
    if (!line.startsWith('data:')) continue
    const value = line.slice(5)
    dataLines.push(value.startsWith(' ') ? value.slice(1) : value)
  }
  if (dataLines.length === 0) return null
  const data = dataLines.join('\n')
  if (data === '[DONE]') return 'done'
  try {
    const parsed = JSON.parse(data) as unknown
    return parsed && typeof parsed === 'object'
      ? (parsed as RawStreamChunk)
      : null
  } catch {
    return null
  }
}

const readRawFrames = (body: ReadableStream<Uint8Array>): RawFrameQueue => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const frames: RawStreamChunk[] = []
  const waiters: Array<(frame: RawStreamChunk | undefined) => void> = []
  let finished = false
  let buffer = ''

  const deliver = (frame: RawStreamChunk) => {
    const waiter = waiters.shift()
    if (waiter) waiter(frame)
    else frames.push(frame)
  }

  const finish = () => {
    if (finished) return
    finished = true
    for (const waiter of waiters.splice(0)) waiter(undefined)
  }

  const drainBuffer = (isFinal: boolean) => {
    const holdsSplitLineBreak = !isFinal && buffer.endsWith('\r')
    const complete = holdsSplitLineBreak ? buffer.slice(0, -1) : buffer
    const parts = complete.replace(/\r\n?/g, '\n').split('\n\n')
    buffer = isFinal ? '' : (parts.pop() ?? '')
    if (holdsSplitLineBreak) buffer += '\r'
    for (const part of parts) {
      const frame = parseFrame(part)
      if (frame === 'done') return true
      if (frame) deliver(frame)
    }
    return false
  }

  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          buffer += decoder.decode()
          drainBuffer(true)
          return
        }
        buffer += decoder.decode(value, { stream: true })
        if (drainBuffer(false)) return
      }
    } catch {
      return
    } finally {
      finish()
      reader.cancel().catch(() => {})
    }
  }
  void pump()

  return {
    next: () => {
      const frame = frames.shift()
      if (frame) return Promise.resolve(frame)
      if (finished) return Promise.resolve(undefined)
      return new Promise((resolve) => waiters.push(resolve))
    },
    cancel: () => {
      finish()
      reader.cancel().catch(() => {})
    },
  }
}

const isAsyncIterable = (
  value: unknown,
): value is AsyncIterable<ChatStreamChunk> =>
  value !== null &&
  typeof value === 'object' &&
  Symbol.asyncIterator in (value as object)

export async function* streamChat(
  request: ChatRequest,
  options: { signal: AbortSignal },
): AsyncGenerator<StreamItem, void, undefined> {
  const key = apiKey() ?? ''
  const channel: { frames: RawFrameQueue | null; headers: Headers | null } = {
    frames: null,
    headers: null,
  }
  const httpClient = new HTTPClient()
  httpClient.addHook('response', (response) => {
    channel.headers = response.headers
    if (!response.ok || !isEventStream(response) || channel.frames) return
    const body = response.clone().body
    if (body) channel.frames = readRawFrames(body)
  })
  const client = createOpenRouterClient(
    atom(key, 'api.streamChat.requestKey'),
    { httpClient },
  )

  try {
    const result: unknown = await client.chat.send(
      { chatRequest: { ...request, stream: true } },
      { signal: options.signal, retries: { strategy: 'none' } },
    )
    if (!isAsyncIterable(result)) {
      throw new TypeError('Expected a streamed chat completion')
    }
    for await (const chunk of result) {
      const raw = channel.frames ? await channel.frames.next() : undefined
      yield { chunk, raw, headers: channel.headers }
    }
  } finally {
    channel.frames?.cancel()
  }
}
