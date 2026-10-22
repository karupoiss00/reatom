import { atom } from '@reatom/core'
import { afterEach, expect, test, vi } from 'test'

import { reatomOtlpAdmin } from '../../otlp'
import { shopOtlpLogs } from '../../otlp/fixtures/analyticsRecords'
import { ADMIN_FRAME } from '../../root'
import { adminSettings } from '../settings'
import { handleAdminShellKey } from './shellKeys'

class DomElement {
  closest(_selector: string): DomElement | null {
    return null
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const shell = {
  querySelector: () => null,
} as unknown as HTMLElement

function key(
  keyName: string,
  target: EventTarget | null = null,
  defaultPrevented = false,
  metaKey = false,
  init: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key: keyName,
    altKey: false,
    shiftKey: false,
    metaKey,
    ctrlKey: false,
    isComposing: false,
    defaultPrevented,
    target,
    preventDefault() {},
    ...init,
  } as KeyboardEvent
}

function shellWithSelection(text: string): HTMLElement {
  const anchor = new DomElement()
  return {
    querySelector: () => null,
    contains: (node: Node) => node === anchor,
    ownerDocument: {
      defaultView: {
        getSelection: () => ({
          isCollapsed: false,
          anchorNode: anchor,
          toString: () => text,
        }),
      },
    },
  } as unknown as HTMLElement
}

test('shortcuts still run when the event was already cancelled', () => {
  vi.stubGlobal('Element', DomElement)
  const admin = reatomOtlpAdmin({
    sourceId: 'keys',
    resource: { 'service.name': 'keys' },
  })
  const helpOpen = ADMIN_FRAME.run(() => atom(false, '_test.shell.help'))
  ADMIN_FRAME.run(() => {
    handleAdminShellKey(shell, key('?', null, true), admin, helpOpen)
  })
  expect(ADMIN_FRAME.run(() => helpOpen())).toBe(true)
})

test('shortcuts ignore editable targets and tab lists', () => {
  vi.stubGlobal('Element', DomElement)
  const admin = reatomOtlpAdmin({
    sourceId: 'keys-skip',
    resource: { 'service.name': 'keys-skip' },
  })
  const helpOpen = ADMIN_FRAME.run(() => atom(false, '_test.shell.help.skip'))
  const input = new DomElement()
  input.closest = (selector) => (selector.includes('input') ? input : null)
  const tab = new DomElement()
  tab.closest = (selector) => (selector === '[role="tablist"]' ? tab : null)

  ADMIN_FRAME.run(() => {
    handleAdminShellKey(
      shell,
      key('?', input as unknown as EventTarget),
      admin,
      helpOpen,
    )
    handleAdminShellKey(
      shell,
      key('?', tab as unknown as EventTarget),
      admin,
      helpOpen,
    )
  })
  expect(ADMIN_FRAME.run(() => helpOpen())).toBe(false)
})

test('i and c toggle display settings unless the field is editable', () => {
  vi.stubGlobal('Element', DomElement)
  const admin = reatomOtlpAdmin({
    sourceId: 'keys-display',
    resource: { 'service.name': 'keys-display' },
  })
  const helpOpen = ADMIN_FRAME.run(() =>
    atom(false, '_test.shell.help.display'),
  )
  const settings = adminSettings()
  ADMIN_FRAME.run(() => {
    settings.icons.setTrue()
    settings.colors.setTrue()
    handleAdminShellKey(shell, key('i'), admin, helpOpen)
    handleAdminShellKey(shell, key('c'), admin, helpOpen)
  })
  expect(ADMIN_FRAME.run(() => settings.icons())).toBe(false)
  expect(ADMIN_FRAME.run(() => settings.colors())).toBe(false)

  const input = new DomElement()
  input.closest = (selector) => (selector.includes('input') ? input : null)
  ADMIN_FRAME.run(() => {
    handleAdminShellKey(
      shell,
      key('i', input as unknown as EventTarget),
      admin,
      helpOpen,
    )
    handleAdminShellKey(shell, key('i', null, false, true), admin, helpOpen)
  })
  expect(ADMIN_FRAME.run(() => settings.icons())).toBe(false)
  ADMIN_FRAME.run(() => {
    settings.icons.setTrue()
    settings.colors.setTrue()
  })
})

test('paths unit keys move and expand the path gantt', () => {
  vi.stubGlobal('Element', DomElement)
  const admin = reatomOtlpAdmin({
    sourceId: 'keys-paths',
    resource: { 'service.name': 'keys-paths' },
  })
  const helpOpen = ADMIN_FRAME.run(() => atom(false, '_test.shell.help.paths'))
  ADMIN_FRAME.run(() => {
    admin.ingest(shopOtlpLogs())
    admin.showPaths()
    admin.analytics.paths.collapseAll()
    handleAdminShellKey(shell, key('j'), admin, helpOpen)
    const selected = admin.analytics.paths.selected()
    expect(selected?.label).toBe('All sessions')
    handleAdminShellKey(shell, key('ArrowRight'), admin, helpOpen)
    expect(
      selected !== null && admin.analytics.paths.isExpanded(selected),
    ).toBe(true)
    handleAdminShellKey(shell, key('Enter'), admin, helpOpen)
    expect(admin.cardOpen()).toBe(true)
    admin.cardOpen.setFalse()
    admin.analytics.paths.select(null)
    handleAdminShellKey(shell, key('Enter'), admin, helpOpen)
    expect(admin.analytics.paths.selected()?.label).toBe('All sessions')
    expect(admin.cardOpen()).toBe(true)
  })
})

test('ctrl and meta chords stay with the browser', () => {
  vi.stubGlobal('Element', DomElement)
  const admin = reatomOtlpAdmin({
    sourceId: 'keys-copy',
    resource: { 'service.name': 'keys-copy' },
  })
  const helpOpen = ADMIN_FRAME.run(() => atom(false, '_test.shell.help.copy'))
  const settings = adminSettings()
  const preventDefault = vi.fn()
  const chord = (
    keyName: string,
    mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
  ) =>
    key(keyName, null, false, mods.meta ?? false, {
      ctrlKey: mods.ctrl ?? false,
      shiftKey: mods.shift ?? false,
      preventDefault,
    })

  ADMIN_FRAME.run(() => {
    settings.icons.setTrue()
    settings.colors.setTrue()
    handleAdminShellKey(shell, chord('c', { ctrl: true }), admin, helpOpen)
    handleAdminShellKey(shell, chord('c', { meta: true }), admin, helpOpen)
    handleAdminShellKey(
      shell,
      chord('C', { ctrl: true, shift: true }),
      admin,
      helpOpen,
    )
    handleAdminShellKey(shell, chord('a', { meta: true }), admin, helpOpen)
    handleAdminShellKey(shell, chord('v', { ctrl: true }), admin, helpOpen)
    handleAdminShellKey(shell, chord('x', { meta: true }), admin, helpOpen)
    handleAdminShellKey(shell, chord('j', { ctrl: true }), admin, helpOpen)
    handleAdminShellKey(shell, chord('?', { meta: true }), admin, helpOpen)
    handleAdminShellKey(
      shell,
      key('c', null, false, false, { isComposing: true, preventDefault }),
      admin,
      helpOpen,
    )
  })
  expect(preventDefault).not.toHaveBeenCalled()
  expect(ADMIN_FRAME.run(() => settings.colors())).toBe(true)
  expect(ADMIN_FRAME.run(() => settings.icons())).toBe(true)
  expect(ADMIN_FRAME.run(() => helpOpen())).toBe(false)
  ADMIN_FRAME.run(() => {
    settings.icons.setTrue()
    settings.colors.setTrue()
  })
})

test('a text selection keeps character keys', () => {
  vi.stubGlobal('Element', DomElement)
  const admin = reatomOtlpAdmin({
    sourceId: 'keys-selection',
    resource: { 'service.name': 'keys-selection' },
  })
  const helpOpen = ADMIN_FRAME.run(() =>
    atom(false, '_test.shell.help.selection'),
  )
  const settings = adminSettings()
  const preventDefault = vi.fn()
  const selected = shellWithSelection('trace id')
  const press = (keyName: string, shiftKey = false) =>
    key(keyName, null, false, false, { shiftKey, preventDefault })

  ADMIN_FRAME.run(() => {
    settings.icons.setTrue()
    settings.colors.setTrue()
    handleAdminShellKey(selected, press('c'), admin, helpOpen)
    handleAdminShellKey(selected, press('i'), admin, helpOpen)
    handleAdminShellKey(selected, press('j'), admin, helpOpen)
    handleAdminShellKey(selected, press('/'), admin, helpOpen)
    handleAdminShellKey(selected, press('?'), admin, helpOpen)
  })
  expect(preventDefault).not.toHaveBeenCalled()
  expect(ADMIN_FRAME.run(() => settings.colors())).toBe(true)
  expect(ADMIN_FRAME.run(() => settings.icons())).toBe(true)
  expect(ADMIN_FRAME.run(() => helpOpen())).toBe(false)

  const arrowPrevent = vi.fn()
  ADMIN_FRAME.run(() => {
    handleAdminShellKey(
      selected,
      key('ArrowDown', null, false, false, { preventDefault: arrowPrevent }),
      admin,
      helpOpen,
    )
    handleAdminShellKey(
      selected,
      key('ArrowDown', null, false, false, {
        shiftKey: true,
        preventDefault: arrowPrevent,
      }),
      admin,
      helpOpen,
    )
  })
  expect(arrowPrevent).toHaveBeenCalledTimes(1)
  ADMIN_FRAME.run(() => {
    settings.icons.setTrue()
    settings.colors.setTrue()
  })
})
