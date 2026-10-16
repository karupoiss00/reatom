import { action, atom, context } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'

export const otel = reatomOpentelemetry({
  name: 'test',
  endpoint: null,
  serviceName: 'shop-test',
})

const cartSize = atom(0, 'cart.size')
const addItem = action(() => cartSize.set((size) => size + 1), 'cart.addItem')

export const recordsOfOneCase = () =>
  context.start(() => {
    addItem()
    return otel.records()
  })

const firstCase = recordsOfOneCase()
const secondCase = recordsOfOneCase()
console.info(firstCase.length, secondCase.length)
