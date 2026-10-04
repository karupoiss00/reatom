import { expect, test } from 'vitest'

import { splitFileNameForTruncation } from './imageFormat'

test('splits long names keeping the extension in the tail', () => {
  expect(splitFileNameForTruncation('004.opaque.gray16be.png')).toEqual({
    head: '004.opaque.gray',
    tail: '16be.png',
  })
  expect(splitFileNameForTruncation('IMG_20240101_123456.jpg')).toEqual({
    head: 'IMG_20240101_12',
    tail: '3456.jpg',
  })
})

test('keeps short names whole', () => {
  expect(splitFileNameForTruncation('a.png')).toEqual({
    head: 'a.png',
    tail: '',
  })
  expect(splitFileNameForTruncation('README')).toEqual({
    head: 'README',
    tail: '',
  })
})

test('truncates extensionless names after the last six characters', () => {
  expect(splitFileNameForTruncation('IMG_20240101_123456')).toEqual({
    head: 'IMG_20240101_',
    tail: '123456',
  })
})

test('treats a leading dot as no extension', () => {
  expect(splitFileNameForTruncation('.hidden-name-x')).toEqual({
    head: '.hidden-',
    tail: 'name-x',
  })
})

test('always reassembles the original name', () => {
  const names = [
    '004.opaque.gray16be.png',
    'a.png',
    'README',
    'IMG_20240101_123456',
    '.gitignore',
    'x.tar.gz',
    'photo.raw',
  ]
  for (const name of names) {
    const { head, tail } = splitFileNameForTruncation(name)
    expect(head + tail).toBe(name)
  }
})
