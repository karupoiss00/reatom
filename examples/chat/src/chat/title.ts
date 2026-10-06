const titleGraphemeLimit = 60

const graphemes = (text: string): string[] => {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
    return Array.from(segmenter.segment(text), (part) => part.segment)
  }
  return Array.from(text)
}

export const chatTitle = (firstUserText: string): string => {
  const singleLine = firstUserText.replace(/\s*[\r\n]+\s*/g, ' ').trim()
  return graphemes(singleLine).slice(0, titleGraphemeLimit).join('').trim()
}
