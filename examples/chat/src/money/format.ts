const CENT_PLACES = 2
const DECIMAL_PRECISION = 12
const MILLION_CUTOFF = 999_950
const UNKNOWN = '\u2014'

type PricePairModel = {
  promptPrice: number
  completionPrice: number
  isFree: boolean
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const expandPlain = (precisionText: string): string => {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(precisionText)
  if (!match) return precisionText
  const whole = match[1] ?? '0'
  const fraction = match[2] ?? ''
  const exponent = match[3] ? Number(match[3]) : 0
  const digits = `${whole}${fraction}`
  const point = whole.length + exponent
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return digits.padEnd(point, '0')
  return `${digits.slice(0, point)}.${digits.slice(point)}`
}

const roundUpDigits = (digits: string): string => {
  const chars = [...digits]
  let index = chars.length - 1
  while (index >= 0 && chars[index] === '9') {
    chars[index] = '0'
    index -= 1
  }
  if (index < 0) return `1${chars.join('')}`
  chars[index] = String(Number(chars[index]) + 1)
  return chars.join('')
}

const roundHalfUpPlaces = (plain: string, places: number): string => {
  const [whole, fraction = ''] = plain.split('.')
  const padded = fraction.padEnd(places + 1, '0')
  const keep = padded.slice(0, places)
  const next = padded[places] ?? '0'
  let digits = `${whole}${keep}`
  let point = whole.length
  if (next >= '5') {
    const rounded = roundUpDigits(digits)
    if (rounded.length > digits.length) point += 1
    digits = rounded
  }
  const wholeOut = digits.slice(0, point).padStart(1, '0')
  const fractionOut = digits.slice(point).padEnd(places, '0')
  return `${wholeOut}.${fractionOut}`
}

export type CostChipAmount = {
  text: string
  figure: string
  unit: '$' | '¢' | null
  sign: '' | '-'
}

const unsignedPlaces = (absolute: number, places: number) =>
  roundHalfUpPlaces(expandPlain(absolute.toPrecision(DECIMAL_PRECISION)), places)

const dollarFigure = (absolute: number) => unsignedPlaces(absolute, CENT_PLACES)

export const formatCostChipAmount = (amount: number): CostChipAmount => {
  if (!isFiniteNumber(amount)) {
    return { text: UNKNOWN, figure: UNKNOWN, unit: null, sign: '' }
  }
  const sign = amount < 0 ? '-' : ''
  const absolute = Math.abs(amount)
  if (absolute < 1) {
    const figure = unsignedPlaces(absolute * 100, CENT_PLACES)
    return { text: `${sign}${figure}¢`, figure, unit: '¢', sign }
  }
  const figure = dollarFigure(absolute)
  return { text: `${sign}$${figure}`, figure, unit: '$', sign }
}

export const formatUsd = (amount: number): string =>
  formatCostChipAmount(amount).text

export const formatEstimate = (amount: number): string => {
  const formatted = formatUsd(amount)
  return formatted === UNKNOWN ? UNKNOWN : `≈ ${formatted}`
}

export const formatPerMillion = (perToken: number): string => {
  if (!isFiniteNumber(perToken)) return UNKNOWN
  const dollars = perToken * 1_000_000
  if (!isFiniteNumber(dollars)) return UNKNOWN
  const sign = dollars < 0 ? '-' : ''
  return `${sign}$${dollarFigure(Math.abs(dollars))}`
}

export const formatPricePair = (model: PricePairModel): string => {
  if (!model || typeof model !== 'object') return UNKNOWN
  if (model.isFree === true) return 'Free'
  if (
    !isFiniteNumber(model.promptPrice) ||
    !isFiniteNumber(model.completionPrice)
  ) {
    return UNKNOWN
  }
  const prompt = formatPerMillion(model.promptPrice)
  const completion = formatPerMillion(model.completionPrice)
  if (prompt === UNKNOWN || completion === UNKNOWN) return UNKNOWN
  return `${prompt} / ${completion} per 1M in/out`
}

const trimOneDecimal = (value: number): string => {
  const text = value.toFixed(1)
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

const formatCompactCount = (count: number): string => {
  if (!isFiniteNumber(count)) return UNKNOWN
  const sign = count < 0 ? '-' : ''
  const rounded = Math.round(Math.abs(count))
  if (rounded < 1000) return `${sign}${rounded}`
  if (rounded < MILLION_CUTOFF) {
    return `${sign}${trimOneDecimal(rounded / 1000)}k`
  }
  return `${sign}${trimOneDecimal(rounded / 1_000_000)}M`
}

export const formatTokenCount = (n: number): string => formatCompactCount(n)

export const formatContextLength = (n: number): string => formatCompactCount(n)
