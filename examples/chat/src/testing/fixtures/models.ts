export type ModelWire = {
  id: string
  canonical_slug: string
  name: string
  created: number
  context_length: number
  architecture: {
    modality: string
    input_modalities: Array<'text' | 'image' | 'file' | 'audio' | 'video'>
    output_modalities: Array<'text'>
    tokenizer: string
    instruct_type: null
  }
  pricing: {
    prompt: string
    completion: string
    image?: string
    request?: string
    web_search?: string
    internal_reasoning?: string
  }
  top_provider: {
    context_length: number
    max_completion_tokens: number
    is_moderated: boolean
  }
  per_request_limits: null
  supported_parameters: string[]
  default_parameters: Record<string, never>
  supported_voices: null
  reasoning?: {
    mandatory: boolean
    supported_efforts?: Array<
      'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    > | null
    default_effort?:
      | 'none'
      | 'minimal'
      | 'low'
      | 'medium'
      | 'high'
      | 'xhigh'
      | 'max'
      | null
  }
  links: { details: string }
}

const model = (
  id: string,
  name: string,
  patch: Partial<ModelWire> &
    Pick<ModelWire, 'context_length' | 'pricing' | 'supported_parameters'> & {
      input_modalities: ModelWire['architecture']['input_modalities']
      modality: string
      tokenizer: string
    },
): ModelWire => ({
  id,
  canonical_slug: id,
  name,
  created: 1721260800,
  context_length: patch.context_length,
  architecture: {
    modality: patch.modality,
    input_modalities: patch.input_modalities,
    output_modalities: ['text'],
    tokenizer: patch.tokenizer,
    instruct_type: null,
  },
  pricing: patch.pricing,
  top_provider: {
    context_length: patch.context_length,
    max_completion_tokens: patch.top_provider?.max_completion_tokens ?? 16384,
    is_moderated: true,
  },
  per_request_limits: null,
  supported_parameters: patch.supported_parameters,
  default_parameters: {},
  supported_voices: null,
  ...(patch.reasoning ? { reasoning: patch.reasoning } : {}),
  links: { details: `/api/v1/models/${id}/endpoints` },
})

export const catalogModels: ModelWire[] = [
  model('meta-llama/llama-3.3-8b-instruct:free', 'Meta: Llama 3.3 8B (free)', {
    context_length: 128000,
    modality: 'text->text',
    input_modalities: ['text'],
    tokenizer: 'Llama3',
    pricing: { prompt: '0', completion: '0' },
    supported_parameters: ['temperature', 'top_p', 'max_tokens'],
  }),
  model('openai/o3-mini', 'OpenAI: o3-mini', {
    context_length: 200000,
    modality: 'text->text',
    input_modalities: ['text'],
    tokenizer: 'GPT',
    pricing: {
      prompt: '0.0000011',
      completion: '0.0000044',
      internal_reasoning: '0.0000044',
    },
    supported_parameters: ['temperature', 'reasoning', 'reasoning_effort'],
    reasoning: {
      mandatory: false,
      default_effort: 'medium',
      supported_efforts: ['minimal', 'low', 'medium', 'high'],
    },
    top_provider: {
      context_length: 200000,
      max_completion_tokens: 100000,
      is_moderated: true,
    },
  }),
  model('google/gemini-2.5-flash', 'Google: Gemini 2.5 Flash', {
    context_length: 1048576,
    modality: 'text+image->text',
    input_modalities: ['text', 'image'],
    tokenizer: 'Gemini',
    pricing: {
      prompt: '0.00000015',
      completion: '0.0000006',
      image: '0.00000075',
      web_search: '0.014',
    },
    supported_parameters: ['temperature', 'tools'],
  }),
  model('anthropic/claude-sonnet-4', 'Anthropic: Claude Sonnet 4', {
    context_length: 200000,
    modality: 'text+image+file->text',
    input_modalities: ['text', 'image', 'file'],
    tokenizer: 'Claude',
    pricing: {
      prompt: '0.000003',
      completion: '0.000015',
      request: '0',
      web_search: '0.014',
    },
    supported_parameters: ['temperature', 'tools', 'reasoning'],
  }),
  model('google/gemini-2.5-pro', 'Google: Gemini 2.5 Pro', {
    context_length: 1048576,
    modality: 'text+image+file->text',
    input_modalities: ['text', 'image', 'file'],
    tokenizer: 'Gemini',
    pricing: {
      prompt: '0.00000125',
      completion: '0.00001',
      image: '0.00000125',
      internal_reasoning: '0.00000375',
    },
    supported_parameters: ['temperature', 'tools', 'reasoning'],
    top_provider: {
      context_length: 1048576,
      max_completion_tokens: 65536,
      is_moderated: true,
    },
  }),
  model('meta-llama/llama-3.3-8b-instruct', 'Meta: Llama 3.3 8B', {
    context_length: 128000,
    modality: 'text->text',
    input_modalities: ['text'],
    tokenizer: 'Llama3',
    pricing: { prompt: '0.00000005', completion: '0.00000008' },
    supported_parameters: ['temperature', 'top_p', 'max_tokens'],
  }),
  model('openai/gpt-4o-mini', 'OpenAI: GPT-4o-mini', {
    context_length: 128000,
    modality: 'text+image+file->text',
    input_modalities: ['text', 'image', 'file'],
    tokenizer: 'GPT',
    pricing: {
      prompt: '0.00000015',
      completion: '0.0000006',
      image: '0.00000075',
      request: '0',
      web_search: '0.014',
      internal_reasoning: '0.00000375',
    },
    supported_parameters: ['tools', 'temperature', 'reasoning'],
  }),
  model('mistralai/mistral-7b-instruct-v0.3', 'Mistral: Mistral 7B Instruct v0.3', {
    context_length: 32768,
    modality: 'text->text',
    input_modalities: ['text'],
    tokenizer: 'Mistral',
    pricing: { prompt: '0.00000003', completion: '0.00000005' },
    supported_parameters: [],
  }),
]

export const freeModelId = 'meta-llama/llama-3.3-8b-instruct:free'
export const paidTwinModelId = 'meta-llama/llama-3.3-8b-instruct'
export const visionModelId = 'google/gemini-2.5-flash'
export const longContextModelId = 'google/gemini-2.5-pro'
export const reasoningEffortsModelId = 'openai/o3-mini'
export const reasoningEfforts = ['minimal', 'low', 'medium', 'high'] as const
export const noParamsModelId = 'mistralai/mistral-7b-instruct-v0.3'
export const curatedMiniModelId = 'openai/gpt-4o-mini'
