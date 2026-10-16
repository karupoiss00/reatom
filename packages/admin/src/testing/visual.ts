import { getAdminRoot } from './admin-root'

async function stabilizeAdminShell(): Promise<void> {
  const root = getAdminRoot()
  const pause = [...root.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === 'Pause',
  )
  if (pause instanceof HTMLElement) pause.click()
  const { waitFor, expect } = await import('storybook/test')
  await waitFor(() => {
    expect(root.textContent ?? '').toContain('Paused')
  })
  await document.fonts.ready
}

export function getAdminVisualSnapshotTarget(): HTMLElement {
  return getAdminRoot()
}

export async function matchElementScreenshot(
  element: HTMLElement,
  screenshotName: string,
  maskSelectors: readonly string[] = [],
): Promise<void> {
  const [{ page }, { expect: vitestExpect }] = await Promise.all([
    import('vitest/browser'),
    import('vitest'),
  ])

  const masks = maskSelectors.flatMap((selector) =>
    [...element.querySelectorAll(selector)].flatMap((node) =>
      node instanceof HTMLElement ? [page.elementLocator(node)] : [],
    ),
  )

  await vitestExpect(page.elementLocator(element)).toMatchScreenshot(
    screenshotName,
    {
      timeout: 20_000,
      screenshotOptions: {
        animations: 'disabled',
        mask: masks,
      },
      comparatorOptions: {
        allowedMismatchedPixelRatio: 0.02,
      },
    },
  )
}

const TIMING_MASKS = [
  '[data-gantt-bars]',
  '[data-testid="gantt-axis"]',
  '[data-gantt-duration]',
] as const

export async function matchAdminScreenshot(
  screenshotName: string,
  box?: { width: number; height: number },
): Promise<void> {
  await stabilizeAdminShell()
  const element = getAdminVisualSnapshotTarget()
  if (box) {
    const shadow = element.getRootNode()
    const host = shadow instanceof ShadowRoot ? shadow.host : null
    if (host instanceof HTMLElement) {
      host.style.right = '0'
      host.style.bottom = '0'
      host.style.border = '0'
      host.style.width = `${box.width}px`
      host.style.height = `${box.height}px`
      host.style.maxWidth = 'none'
      host.style.maxHeight = 'none'
    }
    element.style.boxSizing = 'border-box'
    element.style.width = `${box.width}px`
    element.style.height = `${box.height}px`
    element.style.maxWidth = `${box.width}px`
    element.style.maxHeight = `${box.height}px`
    element.style.overflow = 'hidden'
    element.style.flex = 'none'
  }
  if (box) {
    const { waitFor, expect } = await import('storybook/test')
    let previous = ''
    await waitFor(
      () => {
        const text = element.textContent ?? ''
        const stable = previous !== '' && text === previous
        previous = text
        expect(text).toContain('Paused')
        expect(text).toContain('makeMove')
        expect(text).not.toContain('In progress')
        expect(stable).toBe(true)
      },
      { timeout: 15_000 },
    )
  }
  await document.fonts.ready
  await matchElementScreenshot(element, screenshotName, TIMING_MASKS)
}

export async function matchStoryRootScreenshot(
  root: HTMLElement,
  screenshotName: string,
): Promise<void> {
  await matchElementScreenshot(root, screenshotName)
}
