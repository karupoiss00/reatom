const dayMs = 24 * 60 * 60 * 1000

const calendarDayNumber = (at: number, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(at))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0)
  return Math.round(
    Date.UTC(part('year'), part('month') - 1, part('day')) / dayMs,
  )
}

const monthLabel = (at: number, timeZone: string): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'long',
    year: 'numeric',
  }).format(new Date(at))

export const groupLabel = (
  activityAt: number,
  nowAt: number,
  timeZone: string,
): string => {
  const daysAgo =
    calendarDayNumber(nowAt, timeZone) - calendarDayNumber(activityAt, timeZone)
  if (daysAgo <= 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo <= 7) return 'Previous 7 days'
  if (daysAgo <= 30) return 'Previous 30 days'
  return monthLabel(activityAt, timeZone)
}
