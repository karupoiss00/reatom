import { expect, test } from 'vitest'

import {
  defaultOutputTokens,
  estimateCost,
  estimateTokens,
  formatContextLength,
  formatCostChipAmount,
  formatEstimate,
  formatPerMillion,
  formatPricePair,
  formatTokenCount,
  formatUsd,
} from '../index'

test('R-4: Below $1 it shows cents with two fractional digits: 0.000412 → 0.04¢, 0.0123 → 1.23¢', () => {
  expect(formatUsd(0.000412)).toBe('0.04¢')
  expect(formatUsd(0.0000123456)).toBe('0.00¢')
  expect(formatUsd(0.0004278)).toBe('0.04¢')
  expect(formatUsd(0.0123)).toBe('1.23¢')
  expect(formatUsd(0.0004278)).not.toMatch(/\$/)
  expect(formatUsd(0)).toBe('0.00¢')
  expect(formatUsd(0)).not.toBe('$0.00$')
  expect(formatUsd(0).match(/\$/g) ?? []).toEqual([])
  expect(formatUsd(0).match(/¢/g)).toEqual(['¢'])
  expect(formatUsd(0.0004278).match(/\$/g) ?? []).toEqual([])
})

test('R-4: At $1 or more it shows dollars with 2 decimals: 1.2 → $1.20, 12.3 → $12.30, 74.5 → $74.50', () => {
  expect(formatUsd(1.2)).toBe('$1.20')
  expect(formatUsd(12.3)).toBe('$12.30')
  expect(formatUsd(74.5)).toBe('$74.50')
})

test('R-4: Zero is 0.00¢. There is never scientific notation.', () => {
  expect(formatUsd(0)).toBe('0.00¢')
  expect(formatUsd(1e-9)).toBe('0.00¢')
  expect(formatUsd(1e-9)).not.toMatch(/e/i)
})

test('R-4: Estimates are prefixed with ≈. The word "Free" replaces the amount only where a flow says so.', () => {
  expect(formatEstimate(0.0031)).toBe('≈ 0.31¢')
  expect(formatEstimate(0)).toBe('≈ 0.00¢')
  expect(formatUsd(0)).not.toBe('Free')
})

test('F-11: The fixture\'s 0.000012 shows as "0.00¢". A free model with usage.cost 0 shows "Free" only as a price label, not as formatUsd(0).', () => {
  expect(formatUsd(0.000012)).toBe('0.00¢')
  expect(formatUsd(0)).toBe('0.00¢')
})

test('F-11: Next to the model chip, a sub-cent cost reads "≈ 0.31¢ · 3.2k / 128k"', () => {
  expect(
    `≈ ${formatCostChipAmount(0.0031).text} · ${formatTokenCount(3200)} / ${formatContextLength(128000)}`,
  ).toBe('≈ 0.31¢ · 3.2k / 128k')
})

test('F-04b: the price as "$3.00 / $15.00 per 1M in/out" (R-4 applied to per-token price × 1,000,000) or "Free"', () => {
  expect(formatPerMillion(0.000003)).toBe('$3.00')
  expect(formatPerMillion(0.000015)).toBe('$15.00')
  expect(
    formatPricePair({
      promptPrice: 0.000003,
      completionPrice: 0.000015,
      isFree: false,
    }),
  ).toBe('$3.00 / $15.00 per 1M in/out')
  expect(
    formatPricePair({
      promptPrice: 0,
      completionPrice: 0,
      isFree: true,
    }),
  ).toBe('Free')
})

test('F-04b: "Free" is shown only when both the prompt and completion prices are "0". A :free id with a non-zero listed price shows dollars.', () => {
  expect(
    formatPricePair({
      promptPrice: 0.000001,
      completionPrice: 0.000002,
      isFree: false,
    }),
  ).toBe('$1.00 / $2.00 per 1M in/out')
})

test('F-11: Input tokens = ceil(characters ÷ 4), counted over the R-3 messages plus the current draft.', () => {
  expect(estimateTokens(0)).toBe(0)
  expect(estimateTokens(1)).toBe(1)
  expect(estimateTokens(4)).toBe(1)
  expect(estimateTokens(5)).toBe(2)
  expect(estimateTokens(100_000)).toBe(25_000)
})

test("F-11: Output tokens = the chat's max-output override if one is set, otherwise 500.", () => {
  expect(defaultOutputTokens).toBe(500)
})

test('F-11: Estimate = input × pricing.prompt + output × pricing.completion, shown with "≈" per R-4.', () => {
  const amount = estimateCost({
    inputTokens: 1000,
    outputTokens: defaultOutputTokens,
    promptPrice: 0.000003,
    completionPrice: 0.000015,
  })
  expect(amount).toBeCloseTo(0.0105, 10)
  expect(formatEstimate(amount)).toBe('≈ 1.05¢')
})

test('formatTokenCount maps 3200 to 3.2k and formatContextLength maps 200000 to 200k', () => {
  expect(formatTokenCount(3200)).toBe('3.2k')
  expect(formatContextLength(200000)).toBe('200k')
  expect(formatContextLength(128000)).toBe('128k')
  expect(formatTokenCount(210000)).toBe('210k')
})

test('half-up rounds the decimal the user expects, not the binary value', () => {
  expect(formatUsd(0.015)).toBe('1.50¢')
  expect(formatUsd(0.01555)).toBe('1.56¢')
  expect(formatUsd(0.99)).toBe('99.00¢')
  expect(formatUsd(0.995)).toBe('99.50¢')
  expect(formatUsd(1.005)).toBe('$1.01')
  expect(formatUsd(0.000012345)).toBe('0.00¢')
  expect(formatUsd(3 * 0.005)).toBe('1.50¢')
  expect(formatUsd(1000 * 0.000015)).toBe('1.50¢')
  expect(formatUsd(0.0099999)).toBe('1.00¢')
  expect(formatUsd(1e-20)).toBe('0.00¢')
  expect(formatUsd(1e-20)).not.toMatch(/e/i)
  expect(formatUsd(1e21)).toBe(`$1${'0'.repeat(21)}.00`)
  expect(formatUsd(1e21)).not.toMatch(/e/i)
})

test('F-11 Gemini estimate 4000×0.00000125 + 1000×0.00001 shows ≈ 1.50¢', () => {
  const amount = estimateCost({
    inputTokens: 4000,
    outputTokens: 1000,
    promptPrice: 0.00000125,
    completionPrice: 0.00001,
  })
  expect(formatEstimate(amount)).toBe('≈ 1.50¢')
})

test('unknown amounts render an em dash, never $0.00', () => {
  expect(formatUsd(Number.NaN)).toBe('—')
  expect(formatUsd(Number.POSITIVE_INFINITY)).toBe('—')
  expect(formatUsd(Number.NEGATIVE_INFINITY)).toBe('—')
  expect(formatUsd('1.00' as unknown as number)).toBe('—')
  expect(formatEstimate(Number.NaN)).toBe('—')
  expect(formatEstimate(Number.POSITIVE_INFINITY)).toBe('—')
  expect(formatPerMillion(Number.NaN)).toBe('—')
  expect(formatPerMillion(Number.POSITIVE_INFINITY)).toBe('—')
  expect(
    formatPricePair({
      promptPrice: Number.NaN,
      completionPrice: 0.000015,
      isFree: false,
    }),
  ).toBe('—')
  expect(
    formatPricePair({
      promptPrice: 0.000003,
      completionPrice: '0' as unknown as number,
      isFree: false,
    }),
  ).toBe('—')
  expect(formatTokenCount(Number.NaN)).toBe('—')
  expect(formatContextLength(Number.POSITIVE_INFINITY)).toBe('—')
})

test('formatUsd keeps a negative sign and estimateCost clamps negatives to 0', () => {
  expect(formatUsd(-1)).toBe('-$1.00')
  expect(formatUsd(-0.015)).toBe('-1.50¢')
  expect(
    estimateCost({
      inputTokens: -4,
      outputTokens: 10,
      promptPrice: 1,
      completionPrice: 0.5,
    }),
  ).toBe(5)
  expect(
    estimateCost({
      inputTokens: 10,
      outputTokens: 4,
      promptPrice: -0.01,
      completionPrice: -0.02,
    }),
  ).toBe(0)
  expect(
    Number.isNaN(
      estimateCost({
        inputTokens: Number.NaN,
        outputTokens: 1,
        promptPrice: 1,
        completionPrice: 1,
      }),
    ),
  ).toBe(true)
  expect(
    Number.isNaN(
      estimateCost({
        inputTokens: Number.POSITIVE_INFINITY,
        outputTokens: 1,
        promptPrice: 1,
        completionPrice: 1,
      }),
    ),
  ).toBe(true)
  expect(formatEstimate(Number.NaN)).toBe('—')
})

test('estimateTokens clamps negative and invalid character counts to 0', () => {
  expect(estimateTokens(-1)).toBe(0)
  expect(estimateTokens(-0.5)).toBe(0)
  expect(estimateTokens(Number.NaN)).toBe(0)
  expect(estimateTokens(Number.POSITIVE_INFINITY)).toBe(0)
  expect(estimateTokens('4' as unknown as number)).toBe(0)
})

test('Cost chip amounts use two fractional digits: cents below one dollar, dollars at or above one dollar', () => {
  expect(formatCostChipAmount(0)).toEqual({
    text: '0.00¢',
    figure: '0.00',
    unit: '¢',
    sign: '',
  })
  expect(formatCostChipAmount(0.0042)).toEqual({
    text: '0.42¢',
    figure: '0.42',
    unit: '¢',
    sign: '',
  })
  expect(formatCostChipAmount(0.01)).toEqual({
    text: '1.00¢',
    figure: '1.00',
    unit: '¢',
    sign: '',
  })
  expect(formatCostChipAmount(1.2)).toEqual({
    text: '$1.20',
    figure: '1.20',
    unit: '$',
    sign: '',
  })
  expect(formatCostChipAmount(1.2).text).toMatch(/\.\d{2}$|¢$/)
  expect(formatCostChipAmount(-0.0042).text).toBe('-0.42¢')
  expect(formatUsd(0)).toBe(formatCostChipAmount(0).text)
  expect(formatUsd(0.0004278)).toBe('0.04¢')
  expect(formatUsd(0.0004278)).toBe(formatCostChipAmount(0.0004278).text)
  expect(formatUsd(0.0042)).toBe('0.42¢')
  expect(formatUsd(0.01)).toBe('1.00¢')
  expect(formatUsd(1.2)).toBe('$1.20')
  for (const amount of [0, 0.0004278, 0.0042, 0.01, 1.2, -0.0042]) {
    const text = formatUsd(amount)
    expect(text.match(/\$/g)?.length ?? 0).toBeLessThanOrEqual(1)
    expect(text).not.toMatch(/\$[^$]*\$/)
  }
})

test('screenshot amounts keep their units and do not collapse together', () => {
  const largeReply = 0.03858924
  const shortReply = 0.00042775
  const chatTotal = largeReply + shortReply + 0.00019809
  const draft = estimateCost({
    inputTokens: 986,
    outputTokens: defaultOutputTokens,
    promptPrice: 0.00000015,
    completionPrice: 0.0000005,
  })
  expect(formatUsd(0.0004)).toBe('0.04¢')
  expect(formatUsd(0.04)).toBe('4.00¢')
  expect(formatUsd(0.04)).not.toBe('0.04¢')
  expect(formatUsd(0.0004)).not.toBe(formatUsd(0.04))
  expect(formatUsd(largeReply)).toBe('3.86¢')
  expect(formatUsd(shortReply)).toBe('0.04¢')
  expect(formatUsd(chatTotal)).toBe('3.92¢')
  expect(formatUsd(largeReply)).not.toBe(formatUsd(shortReply))
  expect(formatCostChipAmount(draft).text).toBe('0.04¢')
  expect(formatEstimate(draft)).toBe('≈ 0.04¢')
  for (const amount of [0, 0.0004, 0.04, largeReply, shortReply, draft]) {
    const text = formatUsd(amount)
    const parts = formatCostChipAmount(amount)
    const chip =
      `${parts.sign}${parts.unit === '$' ? '$' : ''}${parts.figure}${parts.unit === '¢' ? '¢' : ''}`
    expect(text).toBe(chip)
    expect(text).not.toBe('$0.04¢')
    expect(text).not.toBe('$0.00$')
    expect(text).not.toMatch(/\$[^$]*¢/)
    expect(text).not.toMatch(/¢[^¢]*\$/)
  }
  expect(formatPerMillion(0.00000015)).toBe('$0.15')
  expect(formatPerMillion(0.0000005)).toBe('$0.50')
  expect(formatPerMillion(0.00000015)).not.toBe('15.00¢')
  expect(formatPerMillion(0.0000005)).not.toBe('50.00¢')
  expect(formatPerMillion(0.000000004)).toBe('$0.00')
  expect(formatPerMillion(0.000000004)).not.toBe('0.40¢')
  expect(
    formatPricePair({
      promptPrice: 0.00000015,
      completionPrice: 0.0000005,
      isFree: false,
    }),
  ).toBe('$0.15 / $0.50 per 1M in/out')
})

test('compact counts use uppercase M at 999,950 and above', () => {
  expect(formatTokenCount(999_949)).toBe('999.9k')
  expect(formatTokenCount(999_950)).toBe('1M')
  expect(formatContextLength(1_000_000)).toBe('1M')
  expect(formatContextLength(1_048_576)).toBe('1M')
  expect(formatTokenCount(1_500_000)).toBe('1.5M')
})
