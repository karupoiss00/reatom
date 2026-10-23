import {
  atom,
  bind,
  computed,
  top,
  type Computed,
  type Ext,
} from '@reatom/core'
import type { ReatomOpentelemetry } from '../reatomOpentelemetry.ts'
import {
  installAttributeSource,
  snapshotAttributes,
  type TelemetryAttributeSource,
} from '../attributeContext.ts'
import { assertFeature } from '../feature.ts'
import { browserCaptureOf } from '../browserCapture.ts'
import { observe, suppressTracing } from '../observation.ts'
import type { OtlpAttrValue } from '../toOtlpValue.ts'
export type { TelemetryAttributeSource }
export const withAttributes =
  (
    source: TelemetryAttributeSource,
  ): Ext<
    ReatomOpentelemetry,
    { attributes: Computed<Readonly<Record<string, OtlpAttrValue>>> }
  > =>
  (otel) => {
    assertFeature(otel, 'attributes')
    if (typeof source !== 'function')
      throw new TypeError(
        '[@reatom/opentelemetry] attributes source must be a reader',
      )
    return suppressTracing(() => {
      let active = true
      const revision = atom(0, `${otel.name}.attributes.revision`)
      const observers = new WeakMap<object, () => void>()
      const references = new Set<WeakRef<() => void>>()
      const invalidate = () => {
        for (const reference of references) {
          const writer = reference.deref()
          if (writer) observe(writer)
          else references.delete(reference)
        }
      }
      // A derived projection, never a second mutable auth store.
      const projection = computed(() => {
        try {
          return snapshotAttributes(source())
        } catch {
          return { 'reatom.attributes_error': 'TypeError' }
        }
      }, `${otel.name}.attributes.projection`)
      const reader = bind(source)
      const attributes = computed(() => {
        const root = top().root
        if (!observers.has(root)) {
          const writer = bind(
            () => revision.set((value) => value + 1),
            root.frame,
          )
          observers.set(root, writer)
          references.add(new WeakRef(writer))
        }
        revision()
        if (!active) return {}
        try {
          return snapshotAttributes(reader())
        } catch {
          return { 'reatom.attributes_error': 'TypeError' }
        }
      }, `${otel.name}.attributes`)
      // Reserve the known native extension member before a reader can reenter.
      Object.defineProperty(otel, 'attributes', {
        value: attributes,
        writable: true,
        configurable: true,
        enumerable: true,
      })
      let clear = () => {}
      let stop = () => {}
      const cleanup = () => {
        if (!active) return
        active = false
        stop()
        clear()
        invalidate()
      }
      try {
        clear = installAttributeSource(otel, reader)
        stop = projection.subscribe(invalidate)
        browserCaptureOf(otel)!.attach(cleanup)
        return { attributes }
      } catch (error) {
        cleanup()
        if (
          (otel as unknown as { attributes?: unknown }).attributes ===
          attributes
        )
          delete (otel as unknown as { attributes?: unknown }).attributes
        throw error
      }
    })
  }
