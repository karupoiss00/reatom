import { context } from '@reatom/core'
import { DOM, stylesheet } from '@reatom/jsx'
import { afterEach, expect, test, vi } from 'test'

import { ADMIN_FRAME } from '../root'
import { bindAdminStylesheet } from './stylesheet'

class FakeCSSStyleSheet {
  cssRules: Array<{ cssText: string }> = []
  insertRule(rule: string, index = this.cssRules.length) {
    this.cssRules.splice(index, 0, { cssText: rule })
    return index
  }
}

function installDom() {
  const sheet = { cssRules: [] as Array<{ cssText: string }> }
  const document = {
    head: {
      appendChild<Node extends { sheet: unknown }>(node: Node) {
        return node
      },
    },
    createElement() {
      return { sheet }
    },
    adoptedStyleSheets: [] as FakeCSSStyleSheet[],
  }
  const fakeWindow = { document }
  vi.stubGlobal('CSSStyleSheet', FakeCSSStyleSheet)
  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal('document', document)
  ADMIN_FRAME.run(() => {
    DOM.set(fakeWindow as unknown as Window & typeof globalThis)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test('binding does not patch context.reset and keeps one sheet per frame', () => {
  installDom()
  const reset = context.reset
  const original = ADMIN_FRAME.run(() => stylesheet())
  const firstShadow = { adoptedStyleSheets: [] as FakeCSSStyleSheet[] }
  const secondShadow = { adoptedStyleSheets: [] as FakeCSSStyleSheet[] }
  const first = ADMIN_FRAME.run(() =>
    bindAdminStylesheet(firstShadow as unknown as ShadowRoot),
  )
  expect(context.reset).toBe(reset)
  const firstSheet = firstShadow.adoptedStyleSheets[0]
  const second = ADMIN_FRAME.run(() =>
    bindAdminStylesheet(secondShadow as unknown as ShadowRoot),
  )
  const secondSheet = secondShadow.adoptedStyleSheets[0]
  expect(ADMIN_FRAME.run(() => stylesheet())).toBe(secondSheet)
  first.restore()
  expect(ADMIN_FRAME.run(() => stylesheet())).toBe(secondSheet)
  second.restore()
  expect(ADMIN_FRAME.run(() => stylesheet())).toBe(original)
  expect(ADMIN_FRAME.run(() => stylesheet())).not.toBe(firstSheet)
})
