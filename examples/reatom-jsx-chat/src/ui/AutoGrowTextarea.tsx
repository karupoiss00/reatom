import type { Atom } from '@reatom/core'
import type { JSX } from '@reatom/jsx'

import { fieldBoxStyles } from './TextField'

export const maxTextareaViewportShare = 0.4

export type AutoGrowTextareaProps = Omit<
  JSX.IntrinsicElements['textarea'],
  'value'
> & {
  value: Atom<string>
  label: string
  variant?: 'bare' | 'boxed'
}

export const resizeToContent = (textarea: HTMLTextAreaElement) => {
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  const maxHeight = Math.floor(viewportHeight * maxTextareaViewportShare)
  textarea.style.height = 'auto'
  const borders = textarea.offsetHeight - textarea.clientHeight
  const contentHeight = textarea.scrollHeight + borders
  const nextHeight = Math.min(contentHeight, maxHeight)
  textarea.style.height = `${nextHeight}px`
  textarea.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden'
}

export const AutoGrowTextarea = ({
  value,
  label,
  variant = 'boxed',
  rows = 1,
  ...rest
}: AutoGrowTextareaProps) => (
  <textarea
    dir="auto"
    {...rest}
    rows={rows}
    data-variant={variant}
    attr:aria-label={label}
    model:value={value}
    on:input={(event) => resizeToContent(event.currentTarget)}
    ref={(textarea: HTMLTextAreaElement) => {
      const unsubscribe = value.subscribe(() =>
        requestAnimationFrame(() => resizeToContent(textarea)),
      )
      const onViewportResize = () => resizeToContent(textarea)
      window.addEventListener('resize', onViewportResize)
      window.visualViewport?.addEventListener('resize', onViewportResize)
      resizeToContent(textarea)
      return () => {
        unsubscribe()
        window.removeEventListener('resize', onViewportResize)
        window.visualViewport?.removeEventListener('resize', onViewportResize)
      }
    }}
    css={`
      display: block;
      width: 100%;
      min-height: var(--control-height);
      max-height: 40dvh;
      resize: none;
      overflow-y: hidden;
      font-size: var(--text-md);
      line-height: var(--leading-body);

      &[data-variant='bare'] {
        padding: var(--space-2) 0;
        border: 0;
        background: transparent;

        &:focus,
        &:focus-visible {
          outline: var(--focus-width) solid var(--focus);
          outline-offset: var(--focus-offset);
        }

        &[data-focus-ring='off']:focus,
        &[data-focus-ring='off']:focus-visible {
          outline: none;
        }
      }

      &[data-variant='boxed'] {
        ${fieldBoxStyles}
        display: block;
        padding: var(--space-2-5, 0.625rem) var(--space-3);

        &:focus-visible,
        &:focus {
          outline: var(--focus-width) solid var(--focus);
          outline-offset: 0;
        }
      }
    `}
  />
)
