import './setup'

import { mount } from '@reatom/jsx'

import { captureOAuthCallback } from './auth/oauth'
import { App } from './App'
import { boot } from './app/boot'
import { ConsentBanner } from './features/consent/ConsentBanner'

captureOAuthCallback()

const appRoot = document.getElementById('app')!
const { unmount } = mount(appRoot, <App />)

const consentHost = document.createElement('div')
consentHost.style.display = 'contents'
document.body.append(consentHost)
const { unmount: unmountConsent } = mount(consentHost, <ConsentBanner />)

boot().catch((error: unknown) => {
  console.error(error)
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unmount()
    unmountConsent()
    consentHost.remove()
  })
}
