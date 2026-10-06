import {
  button,
  createActor,
  heading,
  role,
  text,
  type UserEvent,
} from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, test } from 'vitest'
import { page } from 'vitest/browser'

import { ui } from '../app/ui'
import { bootApp, unmountApp } from './boot'

const I = createActor()

const desktop = { width: 1280, height: 800 }
const phone = { width: 390, height: 844 }

afterEach(async () => {
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('a visitor can see the shell, switch theme, and open the sidebar', async () => {
  await bootApp({ viewport: desktop })
  I.init({
    canvasElement: document.body,
    userEvent: userEvent.setup() as unknown as UserEvent,
  })

  const chats = role('complementary', 'Chats')
  const shortcuts = role('navigation', 'Sidebar shortcuts')

  await I.see(heading('Atelier'))
  await I.see(chats)
  await I.see(text('Conversations').within(chats))
  await I.see(button('New chat').within(chats))
  await I.see(button('Hide sidebar'))
  await I.dontSeeAttribute(chats, 'inert')

  await I.click(button('Hide sidebar'))
  await I.seeAttribute(chats, 'inert')
  await I.dontSeeAttribute(shortcuts, 'inert')
  await I.click(button('Show sidebar'))
  await I.dontSeeAttribute(chats, 'inert')
  await I.seeAttribute(shortcuts, 'inert')
  await I.see(button('New chat').within(chats))

  await page.viewport(phone.width, phone.height)
  await I.see(button('Open sidebar').wait())
  await I.click(button('Open sidebar'))
  const drawer = role('dialog', 'Chats')
  await I.see(drawer)
  await I.see(text('Atelier').within(drawer).wait())
  await I.see(button('New chat').within(drawer))
  await I.see(button('Close sidebar'))
  await I.click(button('Close sidebar'))
  await I.waitExit(drawer)

  ui.appSettings.set('appearance')
  await I.see(heading('Settings').wait())
  await I.see(role('tab', 'Appearance'))
  await I.see(heading('Theme'))
  await I.seeChecked(role('radio', /^System/))

  await I.click(role('radio', 'Dark'))
  await I.seeChecked(role('radio', 'Dark'))
  await I.see(text('Currently dark'))

  await I.click(role('radio', /^System/))
  await I.seeChecked(role('radio', /^System/))
  await I.see(text('Currently light'))
})
