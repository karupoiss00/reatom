import { beforeEach } from 'vitest'

import { resetRuntime } from '../platform/runtime'
import { dbName, dbVersion } from '../storage/db'
import { resetRepoBackend } from '../storage/repo'
import { resetUiState } from '../ui/reset'
import { resetBrowserState, restoreDatabaseVersion } from './env'
import { installOpenRouterMock, resetOpenRouterMock } from './openrouter-mock'

installOpenRouterMock()

beforeEach(async () => {
  resetOpenRouterMock()
  resetRuntime()
  resetUiState()
  await resetBrowserState()
  await restoreDatabaseVersion(dbName, dbVersion)
  resetRepoBackend()
})
