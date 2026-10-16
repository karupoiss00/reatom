import { log, withActionMiddleware, withCallHook } from '@reatom/core'

import { isDevelopment } from './devWarnings.ts'

export const OTEL_INSTANCES_KEY = Symbol.for('reatom.opentelemetry.instances')
const OTEL_LOG_HOOKS_KEY = Symbol.for('reatom.opentelemetry.logHooks')

export type LogEmission = {
  kind: 'log' | 'label'
  params: readonly unknown[]
  payload: unknown
  stateName?: string
}

export type RegisteredInstance = {
  name: string
  creationSite: Error
  dispose: () => void
  emitLog?: (emission: LogEmission) => void
}

type RegistryHolder = typeof globalThis & {
  [OTEL_INSTANCES_KEY]?: Map<string, RegisteredInstance>
  [OTEL_LOG_HOOKS_KEY]?: true
}

export const getInstanceRegistry = (): Map<string, RegisteredInstance> => {
  const holder = globalThis as RegistryHolder
  let registry = holder[OTEL_INSTANCES_KEY]
  if (!registry) {
    registry = new Map()
    holder[OTEL_INSTANCES_KEY] = registry
  }
  return registry
}

const dispatchLog = (emission: LogEmission) => {
  for (const instance of getInstanceRegistry().values()) {
    instance.emitLog?.(emission)
  }
}

const installLogHooks = () => {
  const holder = globalThis as RegistryHolder
  if (holder[OTEL_LOG_HOOKS_KEY]) return
  holder[OTEL_LOG_HOOKS_KEY] = true

  const stateNames = new WeakMap<object, string>()
  let pendingStateName: string | undefined

  try {
    log.extend(
      withActionMiddleware(
        () =>
          (next, ...params) => {
            const result = next(...params)
            if (
              pendingStateName !== undefined &&
              result !== null &&
              typeof result === 'object'
            ) {
              stateNames.set(result, pendingStateName)
            }
            return result
          },
      ),
      withCallHook((payload, params) => {
        dispatchLog({
          kind: 'log',
          params,
          payload,
          stateName:
            payload !== null && typeof payload === 'object'
              ? stateNames.get(payload)
              : undefined,
        })
      }),
    )
    log.label.extend(
      withCallHook((payload, params) => {
        dispatchLog({ kind: 'label', params, payload })
      }),
    )
    const originalState = log.state.bind(log)
    log.state = ((name: string, data: unknown) => {
      pendingStateName = name
      try {
        return originalState(name, data)
      } finally {
        pendingStateName = undefined
      }
    }) as typeof log.state
  } catch {
    holder[OTEL_LOG_HOOKS_KEY] = undefined
  }
}

export const registerInstance = (entry: RegisteredInstance) => {
  const registry = getInstanceRegistry()
  const existing = registry.get(entry.name)
  if (existing) {
    if (isDevelopment()) {
      console.warn(
        `[@reatom/opentelemetry] duplicate live instance name "${entry.name}"`,
        existing.creationSite,
        entry.creationSite,
      )
    }
    existing.dispose()
  }
  registry.set(entry.name, entry)
  installLogHooks()
}

export const unregisterInstance = (entry: RegisteredInstance) => {
  const registry = getInstanceRegistry()
  if (registry.get(entry.name) === entry) registry.delete(entry.name)
}
