export type ChatChunkWire = {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{
    index: number
    delta: Record<string, unknown>
    finish_reason: 'stop' | 'length' | 'error' | 'content_filter' | null
  }>
  error?: {
    code: number
    message: string
    metadata?: {
      error_type: string
      provider_code?: string
      limit_source?: string
    }
  }
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    cost: number
    is_byok: boolean
    completion_tokens_details: { reasoning_tokens: number }
  }
}

const chunk = (
  delta: Record<string, unknown>,
  finishReason: ChatChunkWire['choices'][number]['finish_reason'],
  extra: Pick<ChatChunkWire, 'error' | 'usage'> = {},
): ChatChunkWire => ({
  id: 'gen-fixture',
  object: 'chat.completion.chunk',
  created: 1710000000,
  model: 'openai/gpt-4o-mini',
  choices: [{ index: 0, delta, finish_reason: finishReason }],
  ...extra,
})

const withGenerationId = <T extends { data?: object }>(
  id: string,
  script: readonly T[],
): T[] =>
  script.map((item) =>
    item.data ? { ...item, data: { ...item.data, id } } : item,
  )

const usage = (
  cost: number,
  isByok: boolean,
  reasoningTokens = 0,
): NonNullable<ChatChunkWire['usage']> => ({
  prompt_tokens: 10,
  completion_tokens: 4,
  total_tokens: 14,
  cost,
  is_byok: isByok,
  completion_tokens_details: { reasoning_tokens: reasoningTokens },
})

export const plainTextScript = withGenerationId('gen-1', [
  { data: chunk({ role: 'assistant', content: '' }, null) },
  { data: chunk({ content: 'Hello' }, null) },
  {
    data: chunk({ content: '' }, 'stop', {
      usage: usage(0.000012, false),
    }),
  },
])

export const reasoningScript = withGenerationId('gen-2', [
  { data: chunk({ reasoning: 'think' }, null) },
  {
    data: chunk(
      { reasoning_details: [{ type: 'reasoning.text', text: 'think' }] },
      null,
    ),
  },
  { data: chunk({ content: 'Hi' }, null) },
  {
    data: chunk({ content: '' }, 'stop', {
      usage: usage(0.000021, true, 3),
    }),
  },
])

export const midStreamErrorScript = withGenerationId('gen-3', [
  { data: chunk({ content: 'Partial' }, null) },
  {
    data: chunk({ content: '' }, 'error', {
      error: {
        code: 502,
        message: 'Provider disconnected',
        metadata: { error_type: 'server' },
      },
    }),
  },
])

export const lengthScript = withGenerationId('gen-4', [
  { data: chunk({ content: 'truncated' }, null) },
  {
    data: chunk({ content: '' }, 'length', {
      usage: usage(0.00004, false),
    }),
  },
])

export const lengthWithContentScript = lengthScript

export const midStreamPaymentScript = withGenerationId('gen-5', [
  { data: chunk({ content: 'Partial' }, null) },
  {
    data: chunk({ content: '' }, 'error', {
      error: {
        code: 402,
        message: 'Insufficient credits',
        metadata: {
          error_type: 'payment_required',
          limit_source: 'openrouter_credits',
        },
      },
    }),
  },
])

export const errorOnlyScript = withGenerationId('gen-6', [
  {
    data: chunk({ content: '' }, 'error', {
      error: {
        code: 503,
        message: 'No endpoints available',
        metadata: { error_type: 'provider_unavailable' },
      },
    }),
  },
])

export const emptyReasoningLengthScript = withGenerationId('gen-7', [
  { data: chunk({ reasoning: 'planning the answer' }, null) },
  {
    data: chunk({ content: '' }, 'length', {
      usage: usage(0.0002, false, 3900),
    }),
  },
])

export const emptyStopScript = withGenerationId('gen-8', [
  {
    data: chunk({ role: 'assistant', content: '' }, 'stop', {
      usage: usage(0.000001, false, 0),
    }),
  },
])

export const contentFilterScript = withGenerationId('gen-9', [
  { data: chunk({ content: '' }, 'content_filter') },
])

export const refusalScript = withGenerationId('gen-10', [
  {
    data: chunk(
      { refusal: "I can't help with that request." },
      'content_filter',
    ),
  },
])

export const encryptedReasoningScript = withGenerationId('gen-11', [
  {
    data: chunk(
      {
        reasoning_details: [
          { type: 'reasoning.encrypted', data: 'ciphertext-fixture' },
        ],
      },
      null,
    ),
  },
  {
    data: chunk({ content: '' }, 'stop', {
      usage: usage(0.00003, false, 12),
    }),
  },
])

export const citationsScript = withGenerationId('gen-12', [
  {
    data: {
      ...chunk(
        {
          content: 'See sources',
          annotations: [
            {
              type: 'url_citation',
              url_citation: {
                url: 'https://example.com/a',
                title: 'Alpha',
              },
            },
            {
              type: 'url_citation',
              url_citation: { title: 'Missing url' },
            },
          ],
        },
        'stop',
        { usage: usage(0.00001, false) },
      ),
      provider: 'Perplexity',
      citations: [
        { url: 'https://example.com/a', title: 'Alpha' },
        { title: 'Missing url' },
      ],
    },
  },
])

export const byokUsageScript = withGenerationId('gen-13', [
  { data: chunk({ content: 'Billed to your key' }, null) },
  {
    data: chunk({ content: '' }, 'stop', {
      usage: usage(0.000021, true),
    }),
  },
])

export const freeUsageScript = withGenerationId('gen-14', [
  {
    data: {
      ...chunk({ content: 'Free reply' }, 'stop', {
        usage: usage(0, false),
      }),
      model: 'meta-llama/llama-3.3-8b-instruct:free',
    },
  },
])

export const slowStreamText = 'slow '.repeat(4000)

const slowChunkCount = 10
const slowChunkSize = slowStreamText.length / slowChunkCount

export const slowStreamScript = withGenerationId('gen-15', Array.from(
  { length: slowChunkCount },
  (_, index) => {
    const start = index * slowChunkSize
    const text = slowStreamText.slice(start, start + slowChunkSize)
    const last = index === slowChunkCount - 1
    return {
      delayMs: 20,
      data: chunk(
        { content: text },
        last ? 'stop' : null,
        last ? { usage: usage(0, false) } : {},
      ),
    }
  },
))
