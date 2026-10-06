import './setup'

import { mount } from '@reatom/jsx'

import { captureOAuthCallback } from './auth/oauth'
import { App } from './App'
import { boot } from './app/boot'

captureOAuthCallback()

const { unmount } = mount(document.getElementById('app')!, <App />)

boot().catch((error: unknown) => {
  console.error(error)
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unmount()
  })
}
