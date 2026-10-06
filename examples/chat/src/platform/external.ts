import { onRuntimeReset } from './runtime'

const assignLocation = (url: string) => {
  location.assign(url)
}

let externalNavigator: (url: string) => void = assignLocation

export const navigateExternal = (url: string): void => {
  externalNavigator(url)
}

export const setExternalNavigator = (fn: (url: string) => void): void => {
  externalNavigator = fn
  onRuntimeReset(resetExternalNavigator)
}

export const resetExternalNavigator = (): void => {
  externalNavigator = assignLocation
}

export const openExternal = (url: string): void => {
  window.open(url, '_blank', 'noopener')
}
