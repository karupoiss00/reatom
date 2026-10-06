import { setExternalNavigator } from '../platform/external'

export const captureExternalNavigation = (): string[] => {
  const urls: string[] = []
  setExternalNavigator((url) => {
    urls.push(url)
  })
  return urls
}
