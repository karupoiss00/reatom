import { lastPickedModel } from '../storage/prefs'
import { catalogById } from './catalog'

export const curatedDefaults = [
  'openrouter/auto',
  'openai/gpt-4o-mini',
  'anthropic/claude-sonnet-4.5',
  'google/gemini-2.5-flash',
] as const

const meaningfulId = (id: string | null | undefined): id is string =>
  typeof id === 'string' && id.trim().length > 0

export const resolveNewChatModel = (opts: {
  presetModel: string | null
}): string | null => {
  if (meaningfulId(opts.presetModel)) return opts.presetModel.trim()
  const lastPicked = lastPickedModel()
  if (meaningfulId(lastPicked)) return lastPicked.trim()
  const byId = catalogById()
  return curatedDefaults.find((id) => byId.has(id)) ?? null
}

export const modelName = (id: string): string =>
  catalogById().get(id)?.name ?? id
