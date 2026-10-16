import { action, atom, computed, wrap } from '@reatom/core'
import {
  reatomOpentelemetry,
  type ReatomOpentelemetryInput,
} from '@reatom/opentelemetry'

/** Create tracing before models so the adapter sees their construction. */
export const createTracedCounter = (options: ReatomOpentelemetryInput) => {
  const otel = reatomOpentelemetry(options)
  const count = atom(0, 'example.count')
  const doubled = computed(() => count() * 2, 'example.double')
  const increment = action(
    () => count.set((value) => value + 1),
    'example.increment',
  )
  const update = action(
    () => ({
      count: increment(),
      doubled: doubled(),
      context: otel.traceVar.get(),
    }),
    'example.update',
  )
  const updateAfter = action(async (wait: Promise<void>) => {
    await wrap(wait)
    return increment()
  }, 'example.updateAfter')

  return {
    count,
    doubled,
    update,
    updateAfter,
    flush: otel.flush,
    dispose: otel.dispose,
  }
}
