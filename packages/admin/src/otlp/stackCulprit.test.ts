import { expect, test } from 'test'

import { stackCulprit } from './ingest.ts'

test('stackCulprit skips node_modules, node, and reatom frames', () => {
  expect(
    stackCulprit(`Error: boom
    at wrap (node_modules/@reatom/core/index.js:1:1)
    at action (/code/reatom/packages/core/src/core/atom.ts:10:2)
    at checkout (/app/src/checkout.ts:42:7)`),
  ).toBe('checkout (/app/src/checkout.ts:42:7)')
  expect(
    stackCulprit(`Error: boom
    at run (@reatom/core/dist/index.js:8:1)
    at pay (src/pay.ts:3:1)`),
  ).toBe('pay (src/pay.ts:3:1)')
})
