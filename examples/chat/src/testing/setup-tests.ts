import { beforeEach } from 'vitest'

import { resetRuntime } from '../platform/runtime'
import { dbName, dbVersion } from '../storage/db'
import { resetRepoBackend } from '../storage/repo'
import { resetUiState } from '../ui/reset'
import { resetBrowserState, restoreDatabaseVersion } from './env'
import { installMcpMock, resetMcpMock } from './mcp-mock'
import { installOpenRouterMock, resetOpenRouterMock } from './openrouter-mock'

installMcpMock()
installOpenRouterMock()

beforeEach(async () => {
  resetOpenRouterMock()
  resetMcpMock()
  resetRuntime()
  resetUiState()
  await resetBrowserState()
  await restoreDatabaseVersion(dbName, dbVersion)
  resetRepoBackend()
})
