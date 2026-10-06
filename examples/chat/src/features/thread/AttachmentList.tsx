import { action, atom, wrap, withAsync } from '@reatom/core'

import { repo } from '../../storage/repo'
import type { AttachmentRef } from '../../storage/types'
import { Dialog, Icon } from '../../ui'
import { focusRing } from '../../ui/mixins'

export interface AttachmentListProps {
  attachments: AttachmentRef[]
}

const readDataUrl = async (id: string) => {
  const blob = await repo.getAttachment(id).catch(() => undefined)
  return blob?.dataUrl
}

let attachmentListSerial = 0

export const AttachmentList = ({ attachments }: AttachmentListProps) => {
  const listKey = attachments.map((ref) => ref.id).join('.') || 'empty'
  const name = `features.thread.attachmentList#${listKey}.${++attachmentListSerial}`
  const urls = atom<Record<string, string>>({}, `${name}.urls`)
  const open = atom(false, `${name}.open`)
  const zoomUrl = atom('', `${name}.zoomUrl`)
  const zoomTitle = atom('Preview', `${name}.zoomTitle`)

  const load = action(async () => {
    const next: Record<string, string> = {}
    for (const ref of attachments) {
      const dataUrl = await wrap(readDataUrl(ref.id))
      if (dataUrl) next[ref.id] = dataUrl
    }
    urls.set(next)
  }, `${name}.load`).extend(withAsync())

  const show = (ref: AttachmentRef) => {
    const src = urls()[ref.id]
    if (!src) return
    zoomTitle.set(ref.name)
    zoomUrl.set(src)
    open.set(true)
  }

  return (
    <div
      data-slot="AttachmentList"
      ref={() => {
        if (attachments.length === 0) return
        load().catch(() => {})
      }}
    >
      {attachments.length === 0 ? null : (
        <ul
          css={`
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-end;
            gap: var(--space-2);
            max-width: min(36rem, 100%);
            margin: 0;
            padding: 0;
            list-style: none;
          `}
        >
          {attachments.map((ref) => (
            <li>
              {ref.kind === 'image' ? (
                <button
                  type="button"
                  aria-label={`Open ${ref.name}`}
                  on:click={() => show(ref)}
                  css={`
                    display: grid;
                    justify-items: center;
                    gap: 0.2rem;
                    width: max-content;
                    margin: 0;
                    padding: 0.25rem 0.4rem 0.3rem;
                    border: 1px solid var(--line);
                    border-radius: var(--radius-md);
                    background: var(--bg-sunken);
                    color: var(--text);
                    cursor: pointer;

                    &:focus-visible {
                      ${focusRing}
                    }
                  `}
                >
                  {() =>
                    urls()[ref.id] ? (
                      <img
                        data-attachment-thumb=""
                        alt={ref.name}
                        attr:src={urls()[ref.id]}
                        css={`
                          display: block;
                          width: 4.5rem;
                          height: 4.5rem;
                          object-fit: cover;
                          border-radius: calc(var(--radius-md) - 2px);
                          color: transparent;
                          font-size: 0;
                        `}
                      />
                    ) : (
                      <span
                        css={`
                          display: grid;
                          place-items: center;
                          width: 4.5rem;
                          height: 4.5rem;
                          color: var(--text-muted);
                        `}
                      >
                        <Icon name="image" />
                      </span>
                    )
                  }
                  <span
                    css={`
                      font-size: var(--text-xs);
                      line-height: var(--leading-tight);
                      text-align: center;
                      white-space: nowrap;
                    `}
                  >
                    {ref.name}
                  </span>
                </button>
              ) : (
                <div
                  data-sent-pdf=""
                  css={`
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    max-width: 18rem;
                    min-height: 2.75rem;
                    padding: 0.4rem 0.75rem;
                    border: 1px solid var(--line);
                    border-radius: var(--radius-md);
                    background: var(--bg-elevated);
                    color: var(--text);
                    font-size: var(--text-sm);
                  `}
                >
                  <Icon name="file" size="1.125rem" />
                  <span
                    css={`
                      min-width: 0;
                      overflow: hidden;
                      text-overflow: ellipsis;
                      white-space: nowrap;
                    `}
                  >
                    {ref.name}
                    {ref.pages ? ` · ${ref.pages} ${ref.pages === 1 ? 'page' : 'pages'}` : ''}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} title={zoomTitle} size="md">
        <img
          data-attachment-zoom=""
          alt={() => zoomTitle()}
          attr:src={() => zoomUrl()}
          css={`
            display: block;
            width: 100%;
            height: auto;
            min-width: 20rem;
            border-radius: var(--radius-md);
          `}
        />
      </Dialog>
    </div>
  )
}
