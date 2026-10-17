import {
  resolveCauseChips,
  type AdminRecord,
  type OtlpAdmin,
} from '../../otlp'
import { Button, tokens, type } from '../design-system'
import { KindSwatch } from './KindMark'
import type { RecordKindName } from './recordKind'

function causeSwatchKind(kind: string): RecordKindName {
  if (
    kind === 'action' ||
    kind === 'atom' ||
    kind === 'computed' ||
    kind === 'effect' ||
    kind === 'log' ||
    kind === 'route'
  ) {
    return kind
  }
  return 'framework'
}

export const CauseChips = ({
  admin,
  record,
}: {
  admin: OtlpAdmin
  record: AdminRecord
}) => {
  const chips = resolveCauseChips(record, admin.records())
  if (chips.length === 0) return null
  return (
    <div
      css={`
        display: flex;
        flex-wrap: wrap;
        gap: var(--admin-space-6);
        min-width: 0;
      `}
    >
      {chips.map((chip) =>
        chip.record === undefined ? (
          <span
            css={`
              ${type.meta}
              color: ${tokens.text3};
              font-family: ${tokens.fontData};
            `}
          >
            {chip.id}
          </span>
        ) : (
          <Button
            variant="ghost"
            label={`Select cause ${chip.name}`}
            onClick={() => {
              if (chip.record?.frameId !== undefined) {
                admin.selectFrame(Number(chip.record.frameId))
                admin.cardOpen.setTrue()
              }
            }}
          >
            <KindSwatch kind={causeSwatchKind(chip.kind)} />
            {chip.name}
          </Button>
        ),
      )}
    </div>
  )
}
