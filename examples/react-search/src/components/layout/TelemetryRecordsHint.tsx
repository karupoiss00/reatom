import { Text } from '@mantine/core'
import { reatomComponent } from '@reatom/react'

import { otel } from '../../setup'

export const TelemetryRecordsHint = reatomComponent(() => {
  const count = otel.records().length
  if (!import.meta.env.DEV) return null
  return (
    <Text size="xs" c="dimmed" title="otel.records()">
      {count} otel records
    </Text>
  )
}, 'TelemetryRecordsHint')
