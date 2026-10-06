import type { Repo } from './types'

export const purgeUnheldTombstones = async (
  target: Repo,
  isHeld: (id: string) => Promise<boolean>,
): Promise<void> => {
  const chats = await target.listChats()
  for (const chat of chats) {
    if (chat.deletedAt === null) continue
    if (await isHeld(chat.id)) continue
    await target.purgeChat(chat.id)
  }
  const presets = await target.listPresets()
  for (const preset of presets) {
    if (preset.deletedAt === null) continue
    if (await isHeld(preset.id)) continue
    await target.purgePreset(preset.id)
  }
}
