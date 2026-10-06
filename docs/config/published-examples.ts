export const publishedExamples = ['lens-calculator', 'gallery', 'chat'] as const

export type PublishedExample = (typeof publishedExamples)[number]
