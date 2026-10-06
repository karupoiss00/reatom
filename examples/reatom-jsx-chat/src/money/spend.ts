import type { AssistantMessage } from '../storage/types'

export interface SpendRow {
  key: string
  amount: number
  estimated: boolean
}

const dayMs = 24 * 60 * 60 * 1000
const dayWindow = 30

type Group = { amount: number; estimated: boolean; sort: number }

const finite = (value: number) => Number.isFinite(value)

const contribution = (
  message: AssistantMessage,
): { amount: number; estimated: boolean } | null => {
  let extras = 0
  let hasExtra = false
  for (const extra of message.extraUsage) {
    if (!finite(extra.cost)) continue
    extras += extra.cost
    hasExtra = true
  }
  if (message.usage && finite(message.usage.cost)) {
    return { amount: message.usage.cost + extras, estimated: false }
  }
  const estimate =
    !message.usage && finite(message.estimateCost) && message.estimateCost > 0
      ? message.estimateCost
      : 0
  if (estimate === 0 && !hasExtra) return null
  return { amount: estimate + extras, estimated: estimate > 0 }
}

const calendarParts = (at: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(at))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0)
  return { year: part('year'), month: part('month'), day: part('day') }
}

const calendarDayNumber = (at: number, timeZone: string) => {
  const { year, month, day } = calendarParts(at, timeZone)
  return Math.round(Date.UTC(year, month - 1, day) / dayMs)
}

const dayLabel = (at: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(at))

const addGroup = (
  groups: Map<string, Group>,
  key: string,
  sort: number,
  spend: { amount: number; estimated: boolean },
) => {
  const current = groups.get(key)
  if (!current) {
    groups.set(key, {
      amount: spend.amount,
      estimated: spend.estimated,
      sort,
    })
    return
  }
  current.amount += spend.amount
  current.estimated ||= spend.estimated
}

const rowsFrom = (
  groups: Map<string, Group>,
  compare: (left: [string, Group], right: [string, Group]) => number,
): SpendRow[] =>
  [...groups.entries()].sort(compare).map(([key, group]) => ({
    key,
    amount: group.amount,
    estimated: group.estimated,
  }))

export const spendByDay = (
  messages: AssistantMessage[],
  timeZone: string,
  nowAt: number,
): SpendRow[] => {
  const today = calendarDayNumber(nowAt, timeZone)
  const groups = new Map<string, Group>()
  for (const message of messages) {
    const spend = contribution(message)
    if (!spend) continue
    const day = calendarDayNumber(message.createdAt, timeZone)
    const daysAgo = today - day
    if (daysAgo >= dayWindow) continue
    addGroup(groups, dayLabel(message.createdAt, timeZone), day, spend)
  }
  return rowsFrom(groups, ([, left], [, right]) => right.sort - left.sort)
}

export const spendByModel = (messages: AssistantMessage[]): SpendRow[] => {
  const groups = new Map<string, Group>()
  for (const message of messages) {
    const spend = contribution(message)
    if (!spend) continue
    addGroup(groups, message.model, 0, spend)
  }
  return rowsFrom(
    groups,
    ([leftKey, left], [rightKey, right]) =>
      right.amount - left.amount || leftKey.localeCompare(rightKey),
  )
}
