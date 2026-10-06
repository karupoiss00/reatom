import { openRouter } from '../api/openrouter'
import type { UsageRecord } from '../storage/types'

export const generationBackoffMs = [
  1000, 2000, 4000, 8000, 16000, 29000,
] as const

export const generationSchedule = (capMs: number): number[] => {
  const delays: number[] = []
  let elapsed = 0
  for (const delay of generationBackoffMs) {
    if (elapsed + delay > capMs) break
    elapsed += delay
    delays.push(delay)
  }
  return delays
}

const waitFor = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

const fetchGenerationUsage = async (
  id: string,
  signal: AbortSignal,
): Promise<UsageRecord | null> => {
  try {
    const response = await openRouter().generations.getGeneration(
      { id },
      { signal, retries: { strategy: 'none' } },
    )
    const data = response.data
    if (typeof data.totalCost !== 'number') return null
    return {
      promptTokens: data.tokensPrompt ?? 0,
      completionTokens: data.tokensCompletion ?? 0,
      reasoningTokens: data.nativeTokensReasoning ?? 0,
      cost: data.totalCost,
      isByok: data.isByok === true,
      source: 'generation',
    }
  } catch (error) {
    if (signal.aborted) throw error
    return null
  }
}

export const pollGenerationUsage = async (
  id: string,
  options: { capMs: number; signal: AbortSignal },
): Promise<UsageRecord | null> => {
  for (const delay of generationSchedule(options.capMs)) {
    await waitFor(delay, options.signal)
    const usage = await fetchGenerationUsage(id, options.signal)
    if (usage) return usage
  }
  return null
}
