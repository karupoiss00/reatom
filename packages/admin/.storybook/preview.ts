/// <reference path="../src/global.d.ts" />
import { noop, urlAtom } from '@reatom/core'
import kahramanPreview, { type KahramanParameters } from 'kahraman/preview'
import { setupWorker } from 'msw/browser'
import { mswLoader } from 'msw-storybook-addon/csf3'

import { ADMIN_FRAME } from '../src/root'
import { reatomJsxXoHandlers } from '../src/stories/reatom-jsx-xo/mocks/handlers'
import {
  clearAdminStorage,
  clearCurrentDevtools,
  currentDevtools,
  runStoryCleanups,
} from '../src/testing/storybook-runtime'
import { FALLBACK_VIEWPORT, getViewportSize } from './viewports'

type ViewportGlobal = { value?: string } | string | undefined
type PreviewGlobals = Record<string, ViewportGlobal>
type PreviewContext = {
  globals: PreviewGlobals
  parameters?: KahramanParameters & Record<string, unknown>
}

async function startMswWorker() {
  const worker = setupWorker()
  await worker.start({
    onUnhandledFrame: 'bypass',
    quiet: true,
    serviceWorker: {
      url: `${import.meta.env['BASE_URL']}mockServiceWorker.js`,
    },
  })
  return worker
}

function isolateUrlAtomFromCanvasHistory() {
  urlAtom.sync.set(() => noop)
  urlAtom.catchLinks.set(false)
}

const preview = {
  parameters: {
    a11y: { test: 'todo' },
    msw: {
      handlers: reatomJsxXoHandlers,
    },
  },
  loaders: [mswLoader(startMswWorker)],
  async beforeEach(context: PreviewContext) {
    kahramanPreview.beforeEach(context)
    const { globals } = context

    urlAtom.routes = {}
    isolateUrlAtomFromCanvasHistory()
    ADMIN_FRAME.run(isolateUrlAtomFromCanvasHistory)
    clearAdminStorage()

    if (import.meta.env['VITEST']) {
      const { page } = await import('vitest/browser')
      const viewportGlobal = globals['viewport']
      const viewportName =
        typeof viewportGlobal === 'string'
          ? viewportGlobal
          : viewportGlobal?.value
      const viewport =
        (viewportName ? getViewportSize(viewportName) : null) ??
        FALLBACK_VIEWPORT
      await page.viewport(viewport.width, viewport.height)
    }

    return () => {
      runStoryCleanups()
      if (currentDevtools) {
        currentDevtools.hide()
        currentDevtools.admin.dispose()
        clearCurrentDevtools()
      }
      clearAdminStorage()
    }
  },
}

export default preview
