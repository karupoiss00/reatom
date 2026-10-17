export function writeClipboard(text: string): void {
  const clipboard = globalThis.navigator?.clipboard
  if (clipboard === undefined) return
  void clipboard.writeText(text).catch(() => {})
}
