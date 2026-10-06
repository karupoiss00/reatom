let activeUrl: string | null = null
let revokeTimer: ReturnType<typeof setTimeout> | null = null

export const downloadTextFile = (filename: string, body: string, mime: string) => {
  const blob = new Blob([body], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  if (revokeTimer !== null) clearTimeout(revokeTimer)
  if (activeUrl) URL.revokeObjectURL(activeUrl)
  activeUrl = url
  revokeTimer = setTimeout(() => {
    if (activeUrl !== url) return
    URL.revokeObjectURL(url)
    activeUrl = null
    revokeTimer = null
  }, 30_000)
}
