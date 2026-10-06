import { atom, computed } from '@reatom/core'

const openLayers = atom(0, 'ui.layers.open')
let layerGeneration = 0

/**
 * Number of open overlays (dialogs, menus, popovers, drawers). The topmost
 * layer consumes Esc itself, so a global Esc action (for example "stop
 * streaming" in T-028) must read this in its keydown handler, before any layer
 * has closed, and do nothing while it is above zero:
 *
 * @example
 *   window.addEventListener('keydown', (event) => {
 *     if (event.key !== 'Escape' || openLayerCount() > 0) return
 *     stopStreaming()
 *   }, true)
 */
export const openLayerCount = computed(() => openLayers(), 'ui.layers.count')

/**
 * Marks one overlay as open. Call the returned release function when it
 * closes; extra calls, and calls after `resetOpenLayers`, are ignored.
 */
export const registerOpenLayer = () => {
  const generation = layerGeneration
  openLayers.set((count) => count + 1)
  let released = false
  return () => {
    if (released || generation !== layerGeneration) return
    released = true
    openLayers.set((count) => Math.max(0, count - 1))
  }
}

export const resetOpenLayers = () => {
  layerGeneration += 1
  openLayers.set(0)
}
