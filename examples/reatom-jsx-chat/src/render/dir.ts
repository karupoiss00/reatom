const arabicPunctuation = new Set([0x060c, 0x061b, 0x061f])

const isRtlCode = (code: number) => {
  if (code >= 0x0590 && code <= 0x05ff) return true
  if (code >= 0x0600 && code <= 0x06ff) {
    if (arabicPunctuation.has(code)) return false
    if (code >= 0x0660 && code <= 0x0669) return false
    if (code >= 0x06f0 && code <= 0x06f9) return false
    return true
  }
  if (code >= 0x0750 && code <= 0x077f) return true
  if (code >= 0x08a0 && code <= 0x08ff) return true
  if (code >= 0xfb1d && code <= 0xfb4f) return true
  if (code >= 0xfb50 && code <= 0xfdff) return true
  if (code >= 0xfe70 && code <= 0xfefc) return true
  return false
}

const isLtrCode = (code: number) => {
  if (code >= 0x0041 && code <= 0x005a) return true
  if (code >= 0x0061 && code <= 0x007a) return true
  if (code >= 0x00c0 && code <= 0x02ff) return true
  if (code >= 0x0370 && code <= 0x052f) return true
  if (code >= 0x1e00 && code <= 0x1fff) return true
  if (code >= 0x3040 && code <= 0x30ff) return true
  if (code >= 0x3400 && code <= 0x9fff) return true
  if (code >= 0xac00 && code <= 0xd7af) return true
  return false
}

export const detectDir = (text: string): 'rtl' | 'ltr' | 'auto' => {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (isRtlCode(code)) return 'rtl'
    if (isLtrCode(code)) return 'ltr'
  }
  return 'auto'
}
