import { expect, test } from 'test'

import { sizeFromResizePointer } from './resizeDrag'

test('a bottom-right grip keeps the grabbed point still', () => {
  const origin = {
    anchorRight: true,
    anchorBottom: true,
    left: 200,
    top: 100,
    right: 900,
    bottom: 860,
    originX: 208,
    originY: 108,
  }

  expect(sizeFromResizePointer(origin, 208, 108)).toEqual({
    width: 700,
    height: 760,
  })
  expect(sizeFromResizePointer(origin, 268, 148)).toEqual({
    width: 640,
    height: 720,
  })
})

test('a top-left grip grows from the free corner', () => {
  const origin = {
    anchorRight: false,
    anchorBottom: false,
    left: 16,
    top: 16,
    right: 716,
    bottom: 776,
    originX: 708,
    originY: 768,
  }

  expect(sizeFromResizePointer(origin, 768, 808)).toEqual({
    width: 760,
    height: 800,
  })
})
