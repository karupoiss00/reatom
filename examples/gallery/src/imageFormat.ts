export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export const formatDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

export const formatDimensions = (
  width: number,
  height: number,
  fallback: string,
): string => (width && height ? `${width} x ${height}` : fallback)

export const formatImageCount = (count: number): string => {
  if (count === 0) return ''
  return count === 1 ? '1 image' : `${count} images`
}

export const splitFileNameForTruncation = (
  name: string,
): { head: string; tail: string } => {
  const dotIndex = name.lastIndexOf('.')
  const tail =
    dotIndex > 0 ? name.slice(Math.max(0, dotIndex - 4)) : name.slice(-6)
  if (name.length <= tail.length + 4) return { head: name, tail: '' }
  return { head: name.slice(0, name.length - tail.length), tail }
}
