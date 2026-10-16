import { wrap } from '@reatom/core'

import type { OtlpAdmin } from './chrome'

export async function importRecordFile(
  admin: OtlpAdmin,
  file: { text(): Promise<string> },
): Promise<void> {
  try {
    const text = await wrap(file.text())
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return
    admin.replace(parsed)
    admin.source.set('replay')
  } catch {
    return
  }
}
