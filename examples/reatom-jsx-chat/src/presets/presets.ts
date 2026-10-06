import {
  action,
  addCallHook,
  atom,
  computed,
  withAsync,
  wrap,
} from '@reatom/core'

import { timings } from '../app/timings'
import { now, tabId } from '../platform/env'
import { onRuntimeReset } from '../platform/runtime'
import { recordWriteFailure } from '../storage/health'
import { repo } from '../storage/repo'
import type { ChatParams, PresetId, PresetRecord, WriteFailure } from '../storage/types'
import { holdTombstone, syncReceived } from '../sync'
import type { SyncEvent } from '../sync/types'
import { publishSync } from '../chat/syncPublisher'

export const presetRecords = atom<PresetRecord[]>([], 'presets.records')

export const presets = computed(
  () => presetRecords().filter((preset) => preset.deletedAt === null),
  'presets.list',
)

export const pendingPresetUndo = atom<{ ids: PresetId[]; expiresAt: number } | null>(
  null,
  'presets.pendingUndo',
)

export const presetNameMessage = (
  name: string,
  ignoreId?: PresetId,
): string | null => {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'Name the preset.'
  const taken = presets().some(
    (preset) => preset.id !== ignoreId && preset.name === trimmed,
  )
  return taken ? `A preset named ${trimmed} already exists.` : null
}

const replacePreset = (preset: PresetRecord) => {
  presetRecords.set((current) => {
    const index = current.findIndex((item) => item.id === preset.id)
    if (index < 0) return [...current, preset]
    const next = current.slice()
    next[index] = preset
    return next
  })
}

const writeReason = (error: unknown): WriteFailure['reason'] => {
  if (error && typeof error === 'object' && 'reason' in error) {
    const reason = (error as { reason?: unknown }).reason
    if (reason === 'quota' || reason === 'blocked' || reason === 'unknown') {
      return reason
    }
  }
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : ''
  if (name === 'QuotaExceededError' || /quota/i.test(message)) return 'quota'
  if (
    name === 'InvalidStateError' ||
    name === 'TransactionInactiveError' ||
    name === 'UnknownError' ||
    name === 'TimeoutError' ||
    name === 'NotReadableError'
  ) {
    return 'blocked'
  }
  return 'unknown'
}

const writeTails = new Map<PresetId, Promise<void>>()

const writePreset = action(async (preset: PresetRecord): Promise<boolean> => {
  const previous = writeTails.get(preset.id) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(() => repo.putPreset(preset))
  writeTails.set(
    preset.id,
    run.then(
      () => undefined,
      () => undefined,
    ),
  )
  try {
    await wrap(run)
  } catch (error) {
    recordWriteFailure(writeReason(error))
    return false
  }
  publishSync({ type: 'preset', preset })
  return true
}, 'presets.write').extend(withAsync())

const presetId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `preset-${now().toString(36)}-${Math.random().toString(36).slice(2)}`

export const savePreset = action(
  async (input: {
    name: string
    systemPrompt: string
    model: string | null
    params: ChatParams
  }): Promise<PresetRecord | null> => {
    const name = input.name.trim()
    if (presetNameMessage(name)) return null
    const record: PresetRecord = {
      id: presetId(),
      name,
      systemPrompt: input.systemPrompt,
      model: input.model,
      params: input.params,
      isDefault: false,
      createdAt: now(),
      deletedAt: null,
      deletedByTab: null,
    }
    const saved = await wrap(writePreset(record))
    if (!saved) return null
    replacePreset(record)
    return record
  },
  'presets.save',
).extend(withAsync())

export const renamePreset = action(
  async (id: PresetId, name: string): Promise<boolean> => {
    if (presetNameMessage(name, id)) return false
    const current = presetRecords().find((preset) => preset.id === id)
    if (!current || current.deletedAt !== null) return false
    const next = { ...current, name: name.trim() }
    const saved = await wrap(writePreset(next))
    if (!saved) return false
    replacePreset(next)
    return true
  },
  'presets.rename',
).extend(withAsync())

export const setDefaultPreset = action(async (id: PresetId | null): Promise<boolean> => {
  const current = presetRecords()
  const nextDefault = (preset: PresetRecord) =>
    id !== null && preset.id === id && preset.deletedAt === null
  const changed = current.filter((preset) => preset.isDefault !== nextDefault(preset))
  if (changed.length === 0) return true
  const written: PresetRecord[] = []
  for (const preset of changed) {
    const next = { ...preset, isDefault: nextDefault(preset) }
    const saved = await wrap(writePreset(next))
    if (!saved) return false
    written.push(next)
  }
  for (const preset of written) replacePreset(preset)
  return true
}, 'presets.setDefault').extend(withAsync())

const pendingPurges = new Map<
  PresetId,
  { timer: ReturnType<typeof setTimeout>; hold: { release(): void } }
>()

const releasePurge = (id: PresetId) => {
  const scheduled = pendingPurges.get(id)
  if (!scheduled) return
  clearTimeout(scheduled.timer)
  scheduled.hold.release()
  pendingPurges.delete(id)
}

const releaseAllPurges = () => {
  for (const id of [...pendingPurges.keys()]) releasePurge(id)
}

const forgetUndoId = (id: PresetId) => {
  const pending = pendingPresetUndo()
  if (!pending || !pending.ids.includes(id)) return
  const ids = pending.ids.filter((presetId) => presetId !== id)
  pendingPresetUndo.set(
    ids.length === 0 ? null : { ids, expiresAt: pending.expiresAt },
  )
}

const purgeIfStillDeleted = action(async (id: PresetId) => {
  releasePurge(id)
  const preset = presetRecords().find((item) => item.id === id)
  if (preset && preset.deletedAt === null) return
  await wrap(repo.purgePreset(id))
  presetRecords.set((current) => current.filter((item) => item.id !== id))
  forgetUndoId(id)
  publishSync({ type: 'preset-purged', presetId: id })
}, 'presets.purge').extend(withAsync())

const armPurge = (id: PresetId, delayMs: number) => {
  releasePurge(id)
  const hold = holdTombstone(id, delayMs)
  const timer = setTimeout(() => {
    purgeIfStillDeleted(id).catch(() => {})
  }, delayMs)
  pendingPurges.set(id, { timer, hold })
}

const bindPresetReset = () => {
  onRuntimeReset(() => {
    releaseAllPurges()
    bindPresetReset()
  })
}

bindPresetReset()

const rollbackDelete = (previous: PresetRecord) => {
  const current = presetRecords().find((preset) => preset.id === previous.id)
  if (!current || current.deletedAt === null) return
  replacePreset(previous)
  releasePurge(previous.id)
  forgetUndoId(previous.id)
}

export const deletePreset = action((id: PresetId): void => {
  const current = presetRecords().find((preset) => preset.id === id)
  if (!current || current.deletedAt !== null) return
  const at = now()
  const tombstone: PresetRecord = {
    ...current,
    deletedAt: at,
    deletedByTab: tabId,
  }
  replacePreset(tombstone)
  const previous = pendingPresetUndo()
  const stillPending =
    previous && previous.expiresAt > at
      ? previous.ids.filter((presetId) => presetId !== id)
      : []
  const expiresAt = at + timings.undoMs
  pendingPresetUndo.set({ ids: [...stillPending, id], expiresAt })
  const delayMs = Math.max(0, expiresAt - now())
  for (const presetId of [...stillPending, id]) armPurge(presetId, delayMs)
  void writePreset(tombstone).then(
    wrap((saved) => {
      if (saved) return
      rollbackDelete(current)
    }),
  )
}, 'presets.delete')

export const undoDeletePreset = action((): void => {
  const pending = pendingPresetUndo()
  pendingPresetUndo.set(null)
  if (!pending) return
  for (const id of pending.ids) {
    releasePurge(id)
    const current = presetRecords().find((preset) => preset.id === id)
    if (!current || current.deletedAt === null) continue
    const restored: PresetRecord = {
      ...current,
      deletedAt: null,
      deletedByTab: null,
    }
    replacePreset(restored)
    void writePreset(restored)
  }
}, 'presets.undoDelete')

const receiveSync = (event: SyncEvent) => {
  if (event.type === 'preset') replacePreset(event.preset)
  else if (event.type === 'preset-purged') {
    presetRecords.set((current) =>
      current.filter((preset) => preset.id !== event.presetId),
    )
    forgetUndoId(event.presetId)
  } else if (event.type === 'all-deleted') {
    releaseAllPurges()
    pendingPresetUndo.set(null)
    presetRecords.set([])
  }
}

addCallHook(syncReceived, receiveSync)

export const loadPresets = action(async () => {
  presetRecords.set(await wrap(repo.listPresets()))
}, 'presets.load').extend(withAsync())
