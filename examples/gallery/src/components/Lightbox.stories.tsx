import type { Meta, StoryObj } from '@storybook/html'
import { waitFor } from '@testing-library/dom'
import { expect } from 'storybook/test'

import {
  buildLargeFixtureFolderTree,
  largeFixtureEntries,
  type LargeFixtureEntry,
} from '../__fixtures__/fixtureLoader'
import { mockFolderTree } from '../__fixtures__/mockData'
import { assertHoverChangesPaint } from '../design-system/testing/paint'
import { currentImages, openLightbox } from '../model'
import { StoryWrapper } from '../shared/StoryWrapper'
import { createMyself, type Locator } from '../shared/test'
import { loadGalleryStateWithImageModels } from '../shared/testSetup'
import type { FolderNode } from '../types'
import { Lightbox } from './Lightbox'

const largeFixtureByName = new Map<string, LargeFixtureEntry>(
  largeFixtureEntries.map((entry) => [entry.name, entry]),
)

const loc = {
  lightboxCounterAppears: (canvas) =>
    canvas.findByRole('button', { name: 'Close preview' }),
  closeButtonAppears: (canvas) =>
    canvas.findByRole('button', { name: 'Close preview' }),
  scrubberAppears: (canvas) =>
    canvas.findByRole('slider', { name: 'Folder position' }),
  nextButton: (canvas) => canvas.findByRole('button', { name: 'Next image' }),
} satisfies Record<string, Locator>

const largePhotoDecodeTimeoutMs = 60_000

const I = createMyself((I) => ({
  seeLightboxOpen: async () => {
    await I.see(loc.lightboxCounterAppears)
    await I.see(loc.closeButtonAppears)
    await I.see(loc.scrubberAppears)
  },
  seeFullResolutionImage: async (name: string) => {
    const fixture = largeFixtureByName.get(name)
    if (!fixture) throw new Error(`Unknown large fixture: ${name}`)

    await waitFor(
      async () => {
        const image = await I.resolveLocator((canvas) =>
          canvas.findByAltText(name),
        )
        await expect(image).toBeInstanceOf(HTMLImageElement)
        const { naturalWidth } = image as HTMLImageElement
        await expect(naturalWidth).toBe(fixture.width)
      },
      { timeout: largePhotoDecodeTimeoutMs },
    )
  },
  goToNextImage: async () => {
    await I.click(loc.nextButton)
  },
}))

let largeTree: FolderNode | null = null
let restoreNativeImage: (() => void) | null = null

const loadLargeTree = () => {
  largeTree = buildLargeFixtureFolderTree()
}

const renderLightboxAtIndex = (index: number) => {
  if (!largeTree) throw new Error('Large fixture tree is not loaded')
  loadGalleryStateWithImageModels({ tree: largeTree })
  const target = currentImages()[index]
  if (target) openLightbox(target)
  return (
    <StoryWrapper>
      <Lightbox />
    </StoryWrapper>
  )
}

const largePhotoStoryParameters = {
  vitest: { testTimeout: largePhotoDecodeTimeoutMs },
}

const meta: Meta = {
  title: 'Components/Lightbox',
  loaders: [(ctx) => void I.init(ctx)],
}

export default meta

type Story = StoryObj

export const OpenWithImages: Story = {
  render: () => {
    loadGalleryStateWithImageModels({ tree: mockFolderTree })
    const first = currentImages()[0]
    if (first) openLightbox(first)
    return (
      <StoryWrapper>
        <Lightbox />
      </StoryWrapper>
    )
  },
  play: async () => {
    await I.seeLightboxOpen()
  },
}

const renderCartoonLightbox = (mode: 'light' | 'dark') => {
  loadGalleryStateWithImageModels({ tree: mockFolderTree })
  const first = currentImages()[0]
  if (first) openLightbox(first)
  return (
    <StoryWrapper pack="cartoon" mode={mode}>
      <Lightbox />
    </StoryWrapper>
  )
}

const playCartoonLightboxControls = async () => {
  await I.seeLightboxOpen()
  await assertHoverChangesPaint(await I.see(loc.closeButtonAppears))
  await assertHoverChangesPaint(await I.see(loc.nextButton))
}

export const CartoonLightControlStates: Story = {
  render: () => renderCartoonLightbox('light'),
  play: playCartoonLightboxControls,
}

export const CartoonDarkControlStates: Story = {
  render: () => renderCartoonLightbox('dark'),
  play: playCartoonLightboxControls,
}

/**
 * Regression on generated ~54 MP JPEGs from `__fixtures__/large/`. Navigating
 * to the preloaded neighbor used to get stuck on preview quality because
 * concurrent full-size decodes rejected with EncodingError.
 */
export const FullResolutionAcrossNavigation: Story = {
  parameters: largePhotoStoryParameters,
  loaders: [loadLargeTree],
  render: () => renderLightboxAtIndex(0),
  play: async () => {
    await I.seeLightboxOpen()
    await I.seeFullResolutionImage('large-01.jpg')

    await I.goToNextImage()
    await I.seeFullResolutionImage('large-02.jpg')

    await I.goToNextImage()
    await I.seeFullResolutionImage('large-03.jpg')

    await I.goToNextImage()
    await I.seeFullResolutionImage('large-04.jpg')
  },
}

/**
 * Navigation must keep a paint-ready preview on screen while the next image's
 * sized/full decode is still in flight. A blank frame until full resolution
 * lands is the regression this story guards against.
 */
export const PreviewRemainsVisibleAcrossNavigation: Story = {
  parameters: largePhotoStoryParameters,
  loaders: [loadLargeTree],
  render: () => renderLightboxAtIndex(0),
  play: async () => {
    await I.seeLightboxOpen()
    await I.seeFullResolutionImage('large-01.jpg')

    await I.goToNextImage()

    await waitFor(
      async () => {
        const preview = await I.resolveLocator((canvas) =>
          canvas.findByRole('img', { name: 'large-02.jpg' }),
        )
        if (preview instanceof HTMLImageElement) {
          await expect(preview.naturalWidth).toBeGreaterThan(0)
          return
        }
        if (preview instanceof HTMLCanvasElement) {
          await expect(preview.width).toBeGreaterThan(0)
          return
        }
        throw new Error('Expected a paint-ready lightbox preview')
      },
      { timeout: 5_000 },
    )

    await I.seeFullResolutionImage('large-02.jpg')
  },
}

/** Same regression from the "open the second image first" angle. */
export const FullResolutionFromMiddleImage: Story = {
  parameters: largePhotoStoryParameters,
  loaders: [loadLargeTree],
  render: () => renderLightboxAtIndex(1),
  play: async () => {
    await I.seeLightboxOpen()
    await I.seeFullResolutionImage('large-02.jpg')

    await I.goToNextImage()
    await I.seeFullResolutionImage('large-03.jpg')

    await I.goToNextImage()
    await I.seeFullResolutionImage('large-04.jpg')
  },
}

/**
 * Overlapping `img.decode()` on large photos rejects with EncodingError when
 * decoded frames exceed Chrome's working-set budget. Serialization plus the
 * loaded-bytes fallback must still reach full resolution on the large
 * fixtures.
 */
export const FullResolutionUnderDecodePressure: Story = {
  parameters: largePhotoStoryParameters,
  loaders: [loadLargeTree],
  render: () => {
    const NativeImage = window.Image
    let inFlightDecodes = 0

    class DecodePressureImage extends NativeImage {
      override decode(): Promise<void> {
        inFlightDecodes += 1
        const overloaded = inFlightDecodes > 1
        return super
          .decode()
          .finally(() => {
            inFlightDecodes -= 1
          })
          .then(() => {
            if (overloaded) {
              throw new DOMException(
                'The source image cannot be decoded.',
                'EncodingError',
              )
            }
          })
      }
    }

    window.Image = DecodePressureImage
    restoreNativeImage = () => {
      window.Image = NativeImage
      restoreNativeImage = null
    }

    return renderLightboxAtIndex(0)
  },
  play: async () => {
    try {
      await I.seeLightboxOpen()
      await I.seeFullResolutionImage('large-01.jpg')

      await I.goToNextImage()
      await I.seeFullResolutionImage('large-02.jpg')
    } finally {
      restoreNativeImage?.()
    }
  },
}
