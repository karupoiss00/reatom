import { action, withAsync, wrap } from '@reatom/core'

import { captureOAuthCallback } from '../auth/oauth'
import { initAuth } from '../auth/session'
import { initCatalog } from '../catalog/catalog'
import { library } from '../chat/library'
import { recoverInterrupted } from '../chat/recovery'
import { claimTabId, initPlatform } from '../platform/env'
import { loadPresets } from '../presets/presets'
import { installKeymap } from '../shortcuts/keymap'
import { initStorage } from '../storage'
import { initSync } from '../sync/bus'
import { isTombstoneHeld } from '../sync'
import { overrideTimings, type Timings } from './timings'

export interface BootOptions {
  timings?: Partial<Timings>
}

const continueOnFailure = () => {}

export const boot = action(async (options: BootOptions = {}) => {
  captureOAuthCallback()
  overrideTimings(options.timings)
  initPlatform()
  installKeymap()
  await wrap(claimTabId())
  await wrap(initStorage({ isTombstoneHeld }).catch(continueOnFailure))
  initSync()
  await wrap(
    Promise.all([
      library.reload().catch(continueOnFailure),
      loadPresets().catch(continueOnFailure),
    ]),
  )
  await wrap(recoverInterrupted().catch(continueOnFailure))
  await wrap(initAuth())
  initCatalog()
}, 'app.boot').extend(withAsync())
