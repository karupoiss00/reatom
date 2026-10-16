import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config.js'

const browserApiPort =
  Number(process.env.VITEST_BROWSER_PORT) ||
  64000 + Math.floor(Math.random() * 1000)

export default mergeConfig(
  viteConfig,
  defineConfig({
    server: { hmr: { overlay: false } },
    optimizeDeps: {
      include: ['marked', 'dompurify', 'katex', 'idb', 'axe-core'],
    },
    test: {
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      fileParallelism: false,
      testTimeout: 20_000,
      setupFiles: ['src/testing/setup-tests.ts'],
      api: { port: browserApiPort, strictPort: false },
      browser: {
        enabled: true,
        provider: playwright(),
        headless: true,
        viewport: { width: 1280, height: 800 },
        screenshotFailures: false,
        instances: [{ browser: 'chromium' }],
      },
    },
  }),
)
