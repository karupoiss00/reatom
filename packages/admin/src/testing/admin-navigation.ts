import { urlAtom } from '@reatom/core'
import { expect, userEvent, waitFor } from 'storybook/test'

import { ADMIN_FRAME } from '../root'
import {
  getAdminShadowRoot,
  getAdminText,
} from '../stories/reatom-jsx-xo/testing'

export type AdminRouteLabel =
  | 'Activity'
  | 'State'
  | 'Timeline'
  | 'Graph'
  | 'Filters'

const ROUTE_PATHS: Record<AdminRouteLabel, string> = {
  Activity: '/',
  State: '/state',
  Timeline: '/timeline',
  Graph: '/graph',
  Filters: '/filters',
}

const ROUTE_MARKERS: Record<AdminRouteLabel, RegExp> = {
  Activity: /Activity feed/i,
  State: /State explorer/i,
  Timeline: /Session activity|Event list|No timeline yet/i,
  Graph: /Graph nodes|Causal graph|No graph yet|Select a frame/i,
  Filters: /Filter studio|Tag studio/i,
}

export async function navigateAdminRoute(
  routeLabel: AdminRouteLabel,
): Promise<void> {
  const shadow = getAdminShadowRoot()
  const tabButton = shadow.querySelector(
    `[role="tablist"][aria-label="Admin workspaces"] [role="tab"][aria-label="${routeLabel}"]`,
  )

  if (tabButton instanceof HTMLButtonElement) {
    await userEvent.click(tabButton)
  } else {
    ADMIN_FRAME.run(() => {
      urlAtom.go(ROUTE_PATHS[routeLabel])
    })
  }

  await waitFor(() => {
    expect(getAdminText()).toMatch(ROUTE_MARKERS[routeLabel])
  })
}

export function getAdminRouteButton(
  routeLabel: AdminRouteLabel,
): HTMLButtonElement | null {
  const button = getAdminShadowRoot().querySelector(
    `[role="tablist"][aria-label="Admin workspaces"] [role="tab"][aria-label="${routeLabel}"]`,
  )
  return button instanceof HTMLButtonElement ? button : null
}

export function queryAdminMainRegion(): HTMLElement | null {
  return getAdminShadowRoot().querySelector('main')
}
