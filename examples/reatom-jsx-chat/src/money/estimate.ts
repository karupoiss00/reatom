const finiteNonNegative = (value: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Number.NaN
  return value < 0 ? 0 : value
}

export const estimateTokens = (chars: number): number => {
  if (typeof chars !== 'number' || !Number.isFinite(chars) || chars <= 0)
    return 0
  return Math.ceil(chars / 4)
}

export const estimateCost = ({
  inputTokens,
  outputTokens,
  promptPrice,
  completionPrice,
}: {
  inputTokens: number
  outputTokens: number
  promptPrice: number
  completionPrice: number
}): number => {
  const input = finiteNonNegative(inputTokens)
  const output = finiteNonNegative(outputTokens)
  const prompt = finiteNonNegative(promptPrice)
  const completion = finiteNonNegative(completionPrice)
  if (
    [input, output, prompt, completion].some((value) => Number.isNaN(value))
  ) {
    return Number.NaN
  }
  return input * prompt + output * completion
}

export const defaultOutputTokens = 500 as const
