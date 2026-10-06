export type SkeletonProps = {
  width?: string
  height?: string
  radius?: string
  lines?: number
}

const Bar = ({ width, height, radius }: Required<Omit<SkeletonProps, 'lines'>>) => (
  <span
    data-skeleton=""
    attr:aria-hidden="true"
    css:skeleton-width={width}
    css:skeleton-height={height}
    css:skeleton-radius={radius}
    css={`
      display: block;
      width: var(--skeleton-width);
      max-width: 100%;
      height: var(--skeleton-height);
      border-radius: var(--skeleton-radius);
      background-color: var(--skeleton-base);
      background-image: linear-gradient(
        100deg,
        transparent 20%,
        var(--skeleton-shine) 50%,
        transparent 80%
      );
      background-size: 200% 100%;
      background-repeat: no-repeat;
      animation: ui-shimmer 1.6s var(--ease-standard) infinite;
    `}
  />
)

export const Skeleton = ({
  width = '100%',
  height = '0.875rem',
  radius = 'var(--radius-xs)',
  lines = 1,
}: SkeletonProps) => {
  if (lines <= 1) return <Bar width={width} height={height} radius={radius} />
  return (
    <span
      attr:aria-hidden="true"
      css={`
        display: grid;
        gap: var(--space-2);
        width: 100%;
      `}
    >
      {Array.from({ length: lines }, (_, index) => (
        <Bar
          width={index === lines - 1 ? '62%' : width}
          height={height}
          radius={radius}
        />
      ))}
    </span>
  )
}
