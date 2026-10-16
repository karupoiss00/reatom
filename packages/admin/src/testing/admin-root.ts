/**
 * Element inside the admin shadow root. Actor queries do not cross that
 * boundary.
 */
export function getAdminRoot(): HTMLElement {
  const hosts = document.querySelectorAll('[data-admin-host]')
  const host = hosts[hosts.length - 1]
  const root = host?.shadowRoot?.querySelector(
    '[data-testid="admin-visual-snapshot"]',
  )
  if (!(root instanceof HTMLElement)) {
    throw new Error('Admin root is missing')
  }
  return root
}
