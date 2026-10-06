import { page } from 'vitest/browser'
import { expect } from 'vitest'

const evidenceRoot = '/Users/artalar/code/reatom/.team/evidence'

const relativePath = (fromFile: string, toFile: string) => {
  const fromParts = fromFile
    .split('/')
    .slice(0, -1)
    .filter((part) => part.length > 0)
  const toParts = toFile.split('/').filter((part) => part.length > 0)
  let shared = 0
  while (
    shared < fromParts.length &&
    shared < toParts.length &&
    fromParts[shared] === toParts[shared]
  ) {
    shared += 1
  }
  const up = Array.from({ length: fromParts.length - shared }, () => '..')
  return [...up, ...toParts.slice(shared)].join('/')
}

export const shot = async (flowId: string, name: string) => {
  const target = `${evidenceRoot}/${flowId}/${name}.png`
  const testPath = expect.getState().testPath ?? ''
  const path = testPath.includes('reatom-jsx-chat')
    ? relativePath(testPath, target)
    : target
  return page.screenshot({ path })
}
