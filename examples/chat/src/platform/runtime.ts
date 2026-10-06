const runtimeCleanups = new Set<() => void>()

/**
 * Registers teardown for module-level runtime state (window listeners,
 * channels, once-guards). Installers register on install; `resetRuntime` runs
 * and forgets every registration, so the next install starts fresh.
 */
export const onRuntimeReset = (cleanup: () => void): void => {
  runtimeCleanups.add(cleanup)
}

export const resetRuntime = (): void => {
  const cleanups = [...runtimeCleanups]
  runtimeCleanups.clear()
  for (const cleanup of cleanups) cleanup()
}
