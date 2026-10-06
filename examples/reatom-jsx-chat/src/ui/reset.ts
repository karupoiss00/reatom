import { resetOpenLayers } from './layers'
import { announce } from './LiveRegion'
import { closeAllPopovers } from './Popover'
import { toast } from './Toaster'

/**
 * Returns module-level UI state to a clean slate: toasts and their timers,
 * open popovers and menus, the open-layer count, and the live region text.
 */
export const resetUiState = () => {
  toast.clear()
  closeAllPopovers()
  resetOpenLayers()
  announce('')
}
