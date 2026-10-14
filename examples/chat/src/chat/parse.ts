import type { Citation, UsageRecord } from '../storage/types'
import type { StreamEvent } from './types'

type Rec = Record<string, unknown>

const isRec = (value: unknown): value is Rec =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const field = (source: Rec, snake: string, camel: string): unknown =>
  source[snake] !== undefined ? source[snake] : source[camel]

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const readCost = (value: unknown): number => {
  if (typeof value === 'number') return value
  if (value === null) return Number.NaN
  return 0
}

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const domainOf = (url: string): string | null => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

const toCitation = (candidate: unknown): Citation | null => {
  const source = isRec(candidate)
    ? isRec(field(candidate, 'url_citation', 'urlCitation'))
      ? (field(candidate, 'url_citation', 'urlCitation') as Rec)
      : candidate
    : typeof candidate === 'string'
      ? { url: candidate }
      : null
  if (!source) return null
  const url = nonEmptyString(source.url)
  if (!url) return null
  const domain = domainOf(url)
  if (!domain) return null
  return { url, title: nonEmptyString(source.title), domain }
}

const collectCitations = (chunk: Rec, delta: Rec | null): Citation[] => {
  const candidates: unknown[] = []
  const annotations = delta?.annotations
  if (Array.isArray(annotations)) candidates.push(...annotations)
  const citations = chunk.citations
  if (Array.isArray(citations)) candidates.push(...citations)
  const byUrl = new Map<string, Citation>()
  for (const candidate of candidates) {
    const citation = toCitation(candidate)
    if (!citation) continue
    const known = byUrl.get(citation.url)
    if (!known || (!known.title && citation.title)) {
      byUrl.set(citation.url, citation)
    }
  }
  return [...byUrl.values()]
}

const toUsage = (usage: Rec): UsageRecord => {
  const details = field(usage, 'completion_tokens_details', 'completionTokensDetails')
  const reasoningTokens = isRec(details)
    ? numberOr(field(details, 'reasoning_tokens', 'reasoningTokens'), 0)
    : 0
  return {
    promptTokens: numberOr(field(usage, 'prompt_tokens', 'promptTokens'), 0),
    completionTokens: numberOr(
      field(usage, 'completion_tokens', 'completionTokens'),
      0,
    ),
    reasoningTokens,
    cost: readCost(usage.cost),
    isByok: field(usage, 'is_byok', 'isByok') === true,
    source: 'usage',
  }
}

const toErrorEvent = (error: Rec): StreamEvent => {
  const code = typeof error.code === 'number' ? error.code : null
  const message = typeof error.message === 'string' ? error.message : ''
  const metadata = isRec(error.metadata) ? error.metadata : undefined
  return metadata
    ? { kind: 'error', code, message, metadata }
    : { kind: 'error', code, message }
}

export const chunkToEvents = (chunk: unknown): StreamEvent[] => {
  if (!isRec(chunk)) return []
  const events: StreamEvent[] = []

  const id = nonEmptyString(chunk.id)
  if (id) events.push({ kind: 'id', id })

  const provider = nonEmptyString(chunk.provider)
  if (provider) events.push({ kind: 'provider', name: provider })

  const choices = Array.isArray(chunk.choices) ? chunk.choices : []
  const choice = isRec(choices[0]) ? choices[0] : null
  const delta = choice && isRec(choice.delta) ? choice.delta : null

  if (delta) {
    const reasoning = nonEmptyString(delta.reasoning)
    if (reasoning) events.push({ kind: 'reasoning', text: reasoning })
    const details = field(delta, 'reasoning_details', 'reasoningDetails')
    if (Array.isArray(details) && details.length > 0) {
      events.push({ kind: 'reasoning-details', details })
    }
    const content = nonEmptyString(delta.content)
    if (content) events.push({ kind: 'content', text: content })
    const refusal = nonEmptyString(delta.refusal)
    if (refusal) events.push({ kind: 'refusal', text: refusal })
    const toolCalls = field(delta, 'tool_calls', 'toolCalls')
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      const calls = toolCalls.flatMap((candidate) => {
        if (!isRec(candidate)) return []
        const id = nonEmptyString(candidate.id)
        const fn = isRec(candidate.function) ? candidate.function : null
        const name = fn ? nonEmptyString(fn.name) : null
        if (!id || !name) return []
        const args = typeof fn?.arguments === 'string' ? fn.arguments : ''
        return [{ id, name, arguments: args }]
      })
      if (calls.length > 0) events.push({ kind: 'tool_calls', calls })
    }
  }

  const citations = collectCitations(chunk, delta)
  if (citations.length > 0) events.push({ kind: 'citations', items: citations })

  if (isRec(chunk.error)) events.push(toErrorEvent(chunk.error))

  const finishReason = choice
    ? nonEmptyString(field(choice, 'finish_reason', 'finishReason'))
    : null
  if (finishReason) events.push({ kind: 'finish', reason: finishReason })

  if (isRec(chunk.usage)) {
    events.push({ kind: 'usage', usage: toUsage(chunk.usage) })
  }

  return events
}

export const streamItemToEvents = (item: {
  chunk: unknown
  raw: unknown
}): StreamEvent[] => chunkToEvents(item.raw ?? item.chunk)
