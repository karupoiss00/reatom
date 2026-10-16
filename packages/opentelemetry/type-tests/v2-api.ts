/**
 * V2 public API type tests (F-01, spec test 28).
 *
 * Intended for `pnpm test:types` once `type-tests/tsconfig.json` includes this
 * file (`"./*.ts"` or `"./v2-api.ts"`). Do not add it to `compatibility.ts`.
 *
 * Until OT-1 this file fails to compile against the v1 factory: `name` is not a
 * required key, `endpoint` is `string` rather than `string | null`, and
 * `traceVar` / `parseTraceparent` are not on the instance. After OT-1 the three
 * `@ts-expect-error` cases below are the only intended errors, and the guarded
 * `traceVar.set` call type-checks.
 */
import { reatomOpentelemetry } from '../src/reatomOpentelemetry.ts'

export function v2Construction() {
  return reatomOpentelemetry({
    name: 'shop',
    endpoint: null,
    serviceName: 'shop-web',
  })
}

export function missingEndpointKey() {
  // @ts-expect-error missing endpoint key
  reatomOpentelemetry({ name: 'shop', serviceName: 'shop-web' })
}

export function missingNameKey() {
  // @ts-expect-error missing name key
  reatomOpentelemetry({
    endpoint: 'http://collector.invalid',
    serviceName: 'shop-web',
  })
}

export function misspelledSpanKind() {
  const otel = reatomOpentelemetry({
    name: 'shop',
    endpoint: 'http://collector.invalid',
    serviceName: 'shop-web',
  })
  // @ts-expect-error kind does not include the misspelling 'clinet'
  otel.withOTel({ kind: 'clinet' })
}

export function unguardedTraceparent(header: string | null) {
  const otel = v2Construction()
  // @ts-expect-error parseTraceparent result needs a guard before traceVar.set
  otel.traceVar.set(otel.parseTraceparent(header))
}

export function guardedTraceparent(header: string | null) {
  const otel = v2Construction()
  const remote = otel.parseTraceparent(header)
  if (remote) otel.traceVar.set(remote)
}
