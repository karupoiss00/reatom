const createMemoryStorage = (): Storage => {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key)
    },
    setItem: (key, value) => {
      entries.set(key, String(value))
    },
  }
}

/**
 * A same-origin iframe shares the parent's sessionStorage, while a real
 * second tab has its own. Replace it before any app module reads the tab id.
 */
Object.defineProperty(window, 'sessionStorage', {
  configurable: true,
  value: createMemoryStorage(),
})

/** Vitest rewrites dynamic imports to go through its runner, which only exists in the test realm. */
const realm = globalThis as { __vitest_browser_runner__?: unknown }
realm.__vitest_browser_runner__ ??= {
  wrapDynamicImport: (load: () => Promise<unknown>) => load(),
}

if (new URLSearchParams(location.search).get('locks') === 'off') {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: undefined,
  })
}

await import('./tab-app')

export {}
