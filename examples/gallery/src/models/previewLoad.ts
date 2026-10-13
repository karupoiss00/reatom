import { abortVar, effect, isAbort, take, throwAbort, wrap } from '@reatom/core'

import { yieldToBrowser } from '../yieldToBrowser'
import {
  collectAllGalleryImages,
  folderModelTree,
  type GalleryFolderModel,
} from './collection'
import type { GalleryImageModel } from './contracts'

export const bindBackgroundPreviewLoader = () => {
  const failed = new WeakSet<GalleryImageModel>()
  let tree: GalleryFolderModel | null = null
  let images: GalleryImageModel[] = []
  let cursor = 0

  const loader = effect(async () => {
    while (true) {
      abortVar.throwIfAborted()
      // Even immediately settled jobs must let input and rendering run.
      await wrap(yieldToBrowser())
      const { candidate } = await wrap(
        take(
          () => {
            const nextTree = folderModelTree()
            if (nextTree !== tree) {
              tree = nextTree
              images = tree ? collectAllGalleryImages(tree) : []
              cursor = 0
            }
            if (
              images.some(
                (image) =>
                  image.previewLoadPriority() === 'high' &&
                  image.thumbnail.pending() > 0,
              )
            )
              return null

            while (cursor < images.length) {
              const image = images[cursor]!
              // Never activate off-priority jobs just to inspect their state.
              if (
                image.thumbnailLongEdge() > 0 ||
                failed.has(image) ||
                image.previewLoadPriority() === 'high'
              ) {
                cursor += 1
                continue
              }
              if (image.previewLoadPriority() !== 'off') return null
              return { candidate: image }
            }
            return null
          },
          (next) => next ?? throwAbort(),
          'nextPreview',
        ),
      )

      candidate.previewLoadPriority.set('background')
      try {
        await wrap(candidate.thumbnail())
      } catch (error) {
        if (!isAbort(error)) {
          failed.add(candidate)
          console.error('Background preview load failed:', error)
        }
      } finally {
        if (candidate.previewLoadPriority() === 'background') {
          candidate.previewLoadPriority.set('off')
        }
      }
    }
  }, 'gallery._backgroundPreviewLoader')

  return () => loader.unsubscribe()
}

export function ensureGalleryImagePreviewHigh(image: GalleryImageModel) {
  image.previewLoadPriority.set('high')
}
