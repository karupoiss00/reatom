import { resolveImageOrientationStyle } from '../image-engine/orientation'
import {
  ignoreExifOrientation,
  loupeImage,
  loupePosition,
  loupeVisible,
} from '../model'
import { LOUPE_IMAGE_BOX, LOUPE_MIN_WIDTH } from '../models/loupe'

export const GridLoupe = () => (
  <div
    id="gallery-loupe"
    aria-hidden="true"
    attr:data-open={loupeVisible}
    attr:data-placement={() => loupePosition()?.placement ?? 'above'}
    style:top={() => `${loupePosition()?.top ?? 0}px`}
    style:left={() => `${loupePosition()?.left ?? 0}px`}
    css:image-width={() =>
      `${loupePosition()?.imageBox.width ?? LOUPE_IMAGE_BOX}px`
    }
    css:image-height={() =>
      `${loupePosition()?.imageBox.height ?? LOUPE_IMAGE_BOX}px`
    }
    css={`
      position: fixed;
      z-index: 500;
      padding: 12px;
      pointer-events: none;
      background: var(--panel-bg);
      border: var(--border-width) var(--border-style) var(--border);
      border-radius: var(--radius-md);
      box-shadow: 0 12px 28px var(--shadow-strong);
      color: var(--text-primary);
      opacity: 0;
      visibility: hidden;
      transform: rotate(var(--loupe-tilt, 0deg)) scale(0.95);
      transition:
        opacity 0.12s ease,
        transform 0.12s ease,
        visibility 0.12s;

      &[data-open='true'] {
        opacity: 1;
        visibility: visible;
        transform: rotate(var(--loupe-tilt, 0deg));
      }

      @media (prefers-reduced-motion: reduce) {
        transition: none;
      }

      [data-loupe-body] {
        width: max(var(--image-width), ${LOUPE_MIN_WIDTH}px);
      }
      [data-loupe-image] {
        width: var(--image-width);
        height: var(--image-height);
        margin-inline: auto;
        background: var(--input-bg);
        border-radius: var(--radius-sm);
        overflow: hidden;
      }
      [data-loupe-image] img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
      }
      [data-loupe-name] {
        margin-top: 8px;
        font-size: 12px;
        font-weight: 500;
        line-height: 1.3;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        word-break: break-word;
      }
      [data-loupe-meta] {
        margin-top: 2px;
        font-size: 11px;
        color: var(--text-secondary);
      }
    `}
  >
    <div data-loupe-body>
      {() => {
        const current = loupeImage()?.image
        if (!current) return null

        const thumbnail = current.thumbnail.data()
        const orientationStyle = thumbnail
          ? resolveImageOrientationStyle(
              current.thumbnailMeta.data()?.exif,
              ignoreExifOrientation(),
              thumbnail.orientationBaked || current.display.isRawPipeline(),
            )
          : undefined

        return (
          <>
            <div data-loupe-image>
              {thumbnail ? (
                <img
                  src={thumbnail.url}
                  alt=""
                  style:image-orientation={orientationStyle}
                />
              ) : null}
            </div>
            <div data-loupe-name>{current.source.name}</div>
            <div data-loupe-meta>
              {`${current.display.dimensionsLabel()} · ${current.display.sizeLabel()}`}
            </div>
          </>
        )
      }}
    </div>
  </div>
)
