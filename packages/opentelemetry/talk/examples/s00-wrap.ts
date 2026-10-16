import { action, wrap } from '@reatom/core'

const notifySaved = action(() => 'saved', 'drafts.notifySaved')

export const saveDraftBroken = action(() => {
  setTimeout(() => notifySaved(), 300)
}, 'drafts.saveBroken')

export const saveDraft = action(() => {
  setTimeout(
    wrap(() => notifySaved()),
    300,
  )
}, 'drafts.save')
