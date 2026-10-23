import { reatomOpentelemetry } from '@reatom/opentelemetry'

/**
 * One OpenTelemetry instance for every admin story. Imported by
 * `.storybook/preview.ts` before any example module, so atoms created later are
 * instrumented. Do not recreate it per story.
 */
export const storyOtel = reatomOpentelemetry({
  name: 'admin-stories',
  serviceName: 'admin-stories',
  recordLimit: 5000,
})
