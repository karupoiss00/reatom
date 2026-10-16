import { setProjectAnnotations } from '@storybook/html-vite'
import { afterEach } from 'vitest'
import { page } from 'vitest/browser'

import preview from './preview'

setProjectAnnotations([preview])

afterEach(async (context) => {
  const file = context.task.file?.name ?? ''
  if (
    file.includes('live.stories') ||
    context.task.name.includes('Live OpenRouter')
  ) {
    return
  }
  if (context.task.result?.state !== 'fail') return

  const screenshotPath = context.task.meta?.['screenshotPath']
  if (typeof screenshotPath === 'string') {
    await page.screenshot({ path: screenshotPath })
    return
  }

  await page.screenshot()
})
