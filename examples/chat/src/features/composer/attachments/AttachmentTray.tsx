import { action, atom, computed, withAsync, wrap } from '@reatom/core'

import { catalogById, catalogModels, modelName } from '../../../catalog'
import {
  attachAgainCopy,
  acceptsFiles,
  acceptsImages,
  attachmentSupported,
  attachmentsTooLargeCopy,
  classifyAttachmentFile,
  clipboardDeniedCopy,
  countPdfPages,
  dataUrlWithMime,
  dropToAttachCopy,
  encodingCopy,
  ensureAttachmentGuard,
  ensureFileParserBridge,
  fileTooLargeCopy,
  filesFromClipboardItems,
  filesFromTransfer,
  formatAttachmentSize,
  maxMessageBytes,
  modelAcceptsModality,
  modalitySuggestions,
  paperclipReason,
  pdfParserLabel,
  pdfParserMenu,
  rejectionCopy,
  rememberPdf,
  retargetPdfEngine,
  switchLabel,
  unsupportedTypeCopy,
  type IncomingModality,
} from '../../../chat/attachments'
import { repo } from '../../../storage/repo'
import type { AttachmentRef, PdfEngineLabel } from '../../../storage/types'
import type { JSX } from '@reatom/jsx'

import { Button, Icon, Menu } from '../../../ui'
import { focusRing, uniqueId } from '../../../ui/mixins'
import type { ChatSlotProps } from '../../slots'
import { syncPdfEstimate } from './pdfEstimate'

const createId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `attachment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error(`Couldn't read ${file.name}`))
    }
    reader.onerror = () => reject(reader.error ?? new Error(`Couldn't read ${file.name}`))
    reader.readAsDataURL(file)
  })

const chipCss = `
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  min-width: 0;
  padding-inline: var(--space-3);
  border: 1px solid var(--warning-line);
  border-radius: var(--radius-md);
  background: var(--warning-soft);
  color: var(--text);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);

  & [data-rejection-copy] {
    flex: 1 1 12rem;
    min-width: 0;
  }

  & [data-switch] {
    margin-left: auto;
  }
`

const noteCss = `
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
`

const attachmentChipCss = `
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 100%;
  min-width: 0;
  min-height: 3.25rem;
  padding: 0.35rem 0.35rem 0.35rem 0.45rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text);
  box-shadow: var(--shadow-1);
`

const carriesFiles = (event: DragEvent) => {
  const types = event.dataTransfer?.types
  if (types && [...types].includes('Files')) return true
  return (event.dataTransfer?.files.length ?? 0) > 0
}

type AttachmentTrayProps = ChatSlotProps & {
  editor: JSX.Element
  tools: (trigger: JSX.Element) => JSX.Element
}

export const AttachmentTray = ({ chat, editor, tools }: AttachmentTrayProps) => {
  const name = `features.composer.attachments#${chat.id}`
  const reasonId = uniqueId('attachment-reason')
  const rejections = atom<Array<{ id: string; modality: IncomingModality }>>(
    [],
    `${name}.rejections`,
  )
  const clipboardNote = atom<string | null>(null, `${name}.clipboard`)
  const attachAgain = atom(false, `${name}.attachAgain`)
  const notices = atom<Array<{ id: string; text: string }>>([], `${name}.notices`)
  const encoding = atom<Array<{ id: string; name: string }>>([], `${name}.encoding`)
  const dragging = atom(false, `${name}.dragging`)
  const previews = atom<Record<string, string>>({}, `${name}.previews`)
  const displayName = computed(() => {
    const modelId = chat.model()
    return modelId ? modelName(modelId) : 'This model'
  }, `${name}.label`)
  const catalogModel = computed(() => {
    const modelId = chat.model()
    return modelId ? (catalogById().get(modelId) ?? null) : null
  }, `${name}.catalogModel`)
  const locked = computed(
    () => !acceptsImages(catalogModel()) && !acceptsFiles(catalogModel()),
    `${name}.locked`,
  )
  const trayVisible = computed(
    () =>
      locked() ||
      rejections().length > 0 ||
      notices().length > 0 ||
      encoding().length > 0 ||
      chat.draft.attachments().length > 0 ||
      attachAgain() ||
      clipboardNote() !== null,
    `${name}.trayVisible`,
  )

  let fileInput: HTMLInputElement | null = null
  let dragDepth = 0
  let reservedBytes = 0

  const pushNotice = (text: string) => {
    notices.set((list) =>
      list.some((item) => item.text === text) ? list : [...list, { id: createId(), text }],
    )
  }

  const releaseReserved = (size: number) => {
    reservedBytes = Math.max(0, reservedBytes - size)
  }

  const queuedBytes = () =>
    chat.draft.attachments().reduce((sum, ref) => sum + ref.size, 0) + reservedBytes

  const recordRejection = (modality: IncomingModality) => {
    rejections.set((list) => [
      ...list.filter((item) => item.modality !== modality),
      { id: createId(), modality },
    ])
    attachAgain.set(false)
    clipboardNote.set(null)
  }

  const acceptFile = action(
    async (file: File, kind: 'image' | 'pdf', mime: string) => {
      const id = createId()
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        encoding.set((list) => list.filter((item) => item.id !== id))
        releaseReserved(file.size)
      }
      encoding.set((list) => [...list, { id, name: file.name }])
      try {
        const dataUrl = dataUrlWithMime(await wrap(readDataUrl(file)), mime)
        const pages =
          kind === 'pdf'
            ? countPdfPages(
                await wrap(file.slice(0, Math.min(file.size, 2_000_000)).text()),
              )
            : undefined
        const ref: AttachmentRef = {
          id,
          kind,
          name: file.name,
          mime,
          size: file.size,
          ...(pages ? { pages } : {}),
          ...(kind === 'pdf' ? { pdfEngine: 'text' as const } : {}),
        }
        await wrap(repo.putAttachment({ id, dataUrl }))
        if (kind === 'pdf') rememberPdf(id, dataUrl, 'text')
        const preview =
          kind === 'image' && file.size <= 1024 * 1024
            ? dataUrl
            : URL.createObjectURL(file)
        previews.set((map) => ({ ...map, [id]: preview }))
        settle()
        const used = chat.draft.attachments().reduce((sum, item) => sum + item.size, 0)
        if (used + file.size > maxMessageBytes) {
          pushNotice(attachmentsTooLargeCopy)
          return
        }
        chat.draft.attachments.set((list) => [...list, ref])
      } catch {
        settle()
      }
    },
    `${name}.acceptFile`,
  ).extend(withAsync())

  const ingest = (files: File[]) => {
    const model = catalogModel()
    for (const file of files) {
      const classified = classifyAttachmentFile(file)
      if (!classified.ok) {
        pushNotice(
          classified.reason === 'type'
            ? unsupportedTypeCopy(file.name)
            : fileTooLargeCopy(file.name, file.size),
        )
        continue
      }
      const modality: IncomingModality = classified.kind === 'image' ? 'image' : 'file'
      if (!modelAcceptsModality(model, modality)) {
        recordRejection(modality)
        continue
      }
      if (queuedBytes() + file.size > maxMessageBytes) {
        pushNotice(attachmentsTooLargeCopy)
        continue
      }
      reservedBytes += file.size
      acceptFile(file, classified.kind, classified.mime).catch(() => {})
    }
  }

  const choose = (modelId: string) => {
    const model = catalogById().get(modelId) ?? null
    const before = rejections()
    const next = before.filter((item) => !modelAcceptsModality(model, item.modality))
    chat.setModel(modelId)
    if (next.length !== before.length) attachAgain.set(true)
    rejections.set(next)
  }

  const chooseEngine = (ref: AttachmentRef, engine: PdfEngineLabel) => {
    retargetPdfEngine(ref.id, engine)
    chat.draft.attachments.set((list) =>
      list.map((item) => (item.id === ref.id ? { ...item, pdfEngine: engine } : item)),
    )
  }

  const removeAttachment = (id: string) => {
    chat.draft.attachments.set((list) => list.filter((item) => item.id !== id))
  }

  const readClipboard = action(async () => {
    const read = navigator.clipboard?.read?.bind(navigator.clipboard)
    if (!read) {
      clipboardNote.set(clipboardDeniedCopy)
      return
    }
    try {
      const items = await wrap(read())
      const files = await wrap(filesFromClipboardItems(items))
      if (files.length === 0) {
        clipboardNote.set(clipboardDeniedCopy)
        return
      }
      clipboardNote.set(null)
      ingest(files)
    } catch {
      clipboardNote.set(clipboardDeniedCopy)
    }
  }, `${name}.readClipboard`).extend(withAsync())

  const openPicker = () => {
    if (locked()) return
    fileInput?.click()
  }

  const trigger = (
    <button
      type="button"
      data-attachment-trigger=""
      aria-label="Attach files"
      data-disabled={() => (locked() ? 'true' : 'false')}
      attr:aria-disabled={() => (locked() ? 'true' : 'false')}
      attr:aria-describedby={() => (locked() ? reasonId : null)}
      on:click={openPicker}
      css={`
        display: grid;
        place-items: center;
        flex: none;
        align-self: flex-start;
        width: var(--hit);
        height: var(--hit);
        border: 0;
        border-radius: var(--radius-md);
        background: transparent;
        color: var(--text);
        cursor: pointer;

        &[data-disabled='true'] {
          color: var(--text-muted);
          cursor: default;
        }

        &[data-disabled='false']:hover {
          background: var(--surface-hover);
        }

        &:focus-visible {
          ${focusRing}
        }
      `}
    >
      <Icon name="paperclip" size="1.25rem" />
    </button>
  )

  return (
    <span
      data-slot="AttachmentTray"
      ref={(root) => {
        ensureFileParserBridge()
        const unsubscribeEstimate = chat.draft.attachments.subscribe(
          wrap(() => {
            syncPdfEstimate(chat.draft.attachments())
          }),
        )
        syncPdfEstimate(chat.draft.attachments())
        const form = root.closest('form')
        const onPaste = wrap((event: Event) => {
          const found = filesFromTransfer((event as ClipboardEvent).clipboardData)
          if (found === null) return
          event.preventDefault()
          if (found === 'unreadable') {
            readClipboard()
            return
          }
          ingest(found)
        })
        const onDragEnter = wrap((event: Event) => {
          if (!carriesFiles(event as DragEvent)) return
          event.preventDefault()
          dragDepth += 1
          dragging.set(true)
        })
        const onDragOver = wrap((event: Event) => {
          if (!carriesFiles(event as DragEvent)) return
          event.preventDefault()
        })
        const onDragLeave = wrap((event: Event) => {
          if (!carriesFiles(event as DragEvent)) return
          dragDepth = Math.max(0, dragDepth - 1)
          if (dragDepth === 0) dragging.set(false)
        })
        const onDrop = wrap((event: Event) => {
          const drag = event as DragEvent
          if (!carriesFiles(drag)) return
          event.preventDefault()
          event.stopPropagation()
          dragDepth = 0
          dragging.set(false)
          ingest([...(drag.dataTransfer?.files ?? [])])
        })
        form?.addEventListener('paste', onPaste)
        document.addEventListener('dragenter', onDragEnter, true)
        document.addEventListener('dragover', onDragOver, true)
        document.addEventListener('dragleave', onDragLeave, true)
        document.addEventListener('drop', onDrop, true)
        return () => {
          form?.removeEventListener('paste', onPaste)
          document.removeEventListener('dragenter', onDragEnter, true)
          document.removeEventListener('dragover', onDragOver, true)
          document.removeEventListener('dragleave', onDragLeave, true)
          document.removeEventListener('drop', onDrop, true)
          unsubscribeEstimate()
          syncPdfEstimate([])
        }
      }}
      css="display: contents;"
    >
      {() =>
        dragging() ? (
          <div
            css={`
              position: fixed;
              inset: 0;
              z-index: 30;
              display: flex;
              align-items: flex-end;
              justify-content: center;
              padding: 0 var(--space-6) 8.5rem;
              background: color-mix(in srgb, var(--bg) 72%, transparent);
              pointer-events: none;
            `}
          >
            <div
              data-drop-overlay=""
              role="status"
              css={`
                display: grid;
                justify-items: center;
                gap: var(--space-2);
                min-width: min(18rem, 100%);
                padding: var(--space-5) var(--space-6);
                border: 1.5px dashed var(--accent);
                border-radius: var(--radius-lg);
                background: var(--bg-elevated);
                box-shadow: var(--shadow-3);
                color: var(--text);
                font-family: var(--font-display);
                font-size: var(--text-lg);
              `}
            >
              <Icon name="paperclip" size="1.5rem" />
              {dropToAttachCopy}
            </div>
          </div>
        ) : null
      }
      <div
        data-tray-body=""
        data-open={() => (trayVisible() ? 'true' : 'false')}
        css={`
          display: grid;
          gap: var(--space-2);
          min-width: 0;

          &[data-open='false'] {
            display: none;
          }
        `}
      >
        {() =>
          locked() ? (
            <p id={reasonId} data-attachment-reason="" css={noteCss}>
              {() => paperclipReason(displayName())}
            </p>
          ) : null
        }
      {() =>
        rejections().map((rejection) => {
          const label = switchLabel(rejection.modality)
          const suggestions = modalitySuggestions(
            catalogModels(),
            rejection.modality,
            chat.model(),
          )
          return (
            <div data-rejection={rejection.modality} css={chipCss}>
              <Icon
                name={rejection.modality === 'image' ? 'image' : 'file'}
                size="1.125rem"
              />
              <span data-rejection-copy="">
                {rejectionCopy(displayName(), rejection.modality)}
              </span>
              {suggestions.length === 0 ? null : (
                <span data-switch="">
                  <Menu
                    label={label}
                    placement="top-start"
                    width="20rem"
                    items={suggestions.map((model) => ({
                      label: model.name,
                      onSelect: () => choose(model.id),
                    }))}
                    trigger={(props) => (
                      <Button size="sm" variant="soft" {...props}>
                        {label}
                      </Button>
                    )}
                  />
                </span>
              )}
            </div>
          )
        })
      }
      {() =>
        notices().map((notice) => (
          <div data-attachment-notice="" role="status" css={chipCss}>
            <Icon name="warning" size="1.125rem" />
            <span data-rejection-copy="">{notice.text}</span>
            <button
              type="button"
              aria-label="Dismiss"
              on:click={() =>
                notices.set((list) => list.filter((item) => item.id !== notice.id))
              }
              css={`
                display: grid;
                place-items: center;
                margin-left: auto;
                width: 1.75rem;
                height: 1.75rem;
                border: 0;
                border-radius: var(--radius-pill);
                background: transparent;
                color: var(--text-muted);
                cursor: pointer;

                &:hover {
                  background: var(--surface-hover);
                  color: var(--text);
                }

                &:focus-visible {
                  ${focusRing}
                }
              `}
            >
              <Icon name="close" size="0.9rem" />
            </button>
          </div>
        ))
      }
      {() =>
        encoding().map((item) => (
          <div data-encoding="" role="status" css={attachmentChipCss}>
            <Icon name="paperclip" size="1rem" />
            <span>{encodingCopy(item.name)}</span>
          </div>
        ))
      }
      {() =>
        chat.draft.attachments().map((ref) => {
          const modelId = chat.model()
          const model = modelId ? (catalogById().get(modelId) ?? null) : null
          if (!attachmentSupported(ref, model)) {
            return (
              <div data-pending-unsupported="" css={chipCss}>
                <Icon name="warning" size="1.125rem" />
                <span data-rejection-copy="">
                  {modelId
                    ? `Not supported by ${modelName(modelId)}`
                    : 'Not supported by this model'}
                </span>
              </div>
            )
          }
          const preview = previews()[ref.id]
          return (
            <div data-attachment-chip="" data-pending={ref.id} css={attachmentChipCss}>
              {ref.kind === 'image' && preview ? (
                <img
                  alt=""
                  attr:src={preview}
                  css={`
                    width: 2.75rem;
                    height: 2.75rem;
                    flex: none;
                    object-fit: cover;
                    border-radius: var(--radius-sm);
                    background: var(--bg-sunken);
                  `}
                />
              ) : (
                <span
                  css={`
                    display: grid;
                    place-items: center;
                    width: 2.75rem;
                    height: 2.75rem;
                    flex: none;
                    border-radius: var(--radius-sm);
                    background: var(--bg-sunken);
                    color: var(--text-muted);
                  `}
                >
                  <Icon name={ref.kind === 'image' ? 'image' : 'file'} size="1.125rem" />
                </span>
              )}
              <span
                css={`
                  display: grid;
                  flex: 1 1 auto;
                  min-width: 0;
                  gap: 0.1rem;
                `}
              >
                <span
                  data-attachment-name=""
                  css={`
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: var(--text-sm);
                  `}
                >
                  {ref.name}
                </span>
                <span
                  data-attachment-size=""
                  css={`
                    color: var(--text-muted);
                    font-size: var(--text-xs);
                    font-variant-numeric: tabular-nums;
                  `}
                >
                  {formatAttachmentSize(ref.size)}
                  {ref.pages ? ` · ${ref.pages} ${ref.pages === 1 ? 'page' : 'pages'}` : ''}
                </span>
              </span>
              {ref.kind === 'pdf' ? (
                <Menu
                  label="PDF parser"
                  placement="top-start"
                  width="20rem"
                  items={() =>
                    pdfParserMenu.map((choice) => ({
                      label: choice.label,
                      selected: (ref.pdfEngine ?? 'text') === choice.id,
                      onSelect: () => chooseEngine(ref, choice.id),
                    }))
                  }
                  trigger={(props) => (
                    <Button size="sm" variant="soft" aria-label="PDF parser" {...props}>
                      {pdfParserLabel(ref.pdfEngine)}
                    </Button>
                  )}
                />
              ) : null}
              <button
                type="button"
                aria-label={`Remove ${ref.name}`}
                on:click={() => removeAttachment(ref.id)}
                css={`
                  display: grid;
                  place-items: center;
                  flex: none;
                  width: 1.75rem;
                  height: 1.75rem;
                  border: 0;
                  border-radius: var(--radius-pill);
                  background: transparent;
                  color: var(--text-muted);
                  cursor: pointer;

                  &:hover {
                    background: var(--surface-hover);
                    color: var(--text);
                  }

                  &:focus-visible {
                    ${focusRing}
                  }
                `}
              >
                <Icon name="close" size="0.9rem" />
              </button>
            </div>
          )
        })
      }
      {() =>
        attachAgain() ? (
          <p data-attach-again="" css={noteCss}>
            {attachAgainCopy}
          </p>
        ) : null
      }
      {() =>
        clipboardNote() ? (
          <p data-clipboard-error="" role="status" css={chipCss}>
            {clipboardNote()}
          </p>
        ) : null
      }
      </div>
      <input
        type="file"
        data-attachment-input=""
        aria-label="Attach files"
        accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
        tabindex={-1}
        multiple
        ref={(element) => {
          fileInput = element
        }}
        on:change={(event) => {
          const input = event.currentTarget
          if (!(input instanceof HTMLInputElement)) return
          const files = [...(input.files ?? [])]
          input.value = ''
          if (files.length === 0) return
          ingest(files)
        }}
        css={`
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
          border: 0;
        `}
      />
      {editor}
      {tools(trigger)}
    </span>
  )
}

ensureAttachmentGuard()
