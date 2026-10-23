/** Required construction fields and trace-context narrowing remain stable. */
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
