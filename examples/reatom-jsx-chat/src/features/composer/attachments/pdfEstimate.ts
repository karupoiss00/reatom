import { extraEstimateLines } from '../../../app/ui'
import type { AttachmentRef } from '../../../storage/types'

export const pdfParsingKey = 'pdf-parsing'

const ocrUsdPerThousandPages = 2

const billedPages = (ref: AttachmentRef) =>
  ref.pages && ref.pages > 0 ? ref.pages : 1000

export const syncPdfEstimate = (attachments: readonly AttachmentRef[]) => {
  const ocr = attachments.filter((ref) => ref.kind === 'pdf' && ref.pdfEngine === 'ocr')
  extraEstimateLines.set((lines) => {
    const rest = lines.filter((line) => line.key !== pdfParsingKey)
    if (ocr.length === 0) return rest.length === lines.length ? lines : rest
    const pages = ocr.reduce((sum, ref) => sum + billedPages(ref), 0)
    const amount = (pages / 1000) * ocrUsdPerThousandPages
    const current = lines.find((line) => line.key === pdfParsingKey)
    if (
      current &&
      current.amount === amount &&
      current.label === 'PDF parsing' &&
      rest.length + 1 === lines.length
    ) {
      return lines
    }
    return [...rest, { key: pdfParsingKey, label: 'PDF parsing', amount }]
  })
}
