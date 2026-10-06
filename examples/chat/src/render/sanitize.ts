import DOMPurify from 'dompurify'

const xhtmlNamespace = 'http://www.w3.org/1999/xhtml'

const baseTags = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'del',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
  'br',
  'span',
  'div',
  'input',
]

const baseAttributes = [
  'href',
  'class',
  'align',
  'type',
  'checked',
  'disabled',
  'dir',
  'target',
  'rel',
  'data-md-slot',
]

const forbiddenTags = [
  'form',
  'video',
  'audio',
  'source',
  'iframe',
  'object',
  'embed',
  'img',
  'button',
  'style',
  'script',
  'link',
  'meta',
  'base',
]

export type SanitizeExtra = {
  tags?: readonly string[]
  attributes?: readonly string[]
  namespaces?: readonly string[]
}

let activeExtra: SanitizeExtra | undefined

const extensionSlots = new Map<string, DocumentFragment>()

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const controlChars =
  /[\u0000-\u001F\u007F\u00A0\u1680\u2000-\u200D\u2028\u2029\u202A-\u202E\u202F\u205F\u2060\u2066-\u2069\u3000\uFEFF]/g

const stripBidi = (value: string) =>
  value.replace(/[\u202A-\u202E\u2066-\u2069]/g, '')

const stripBidiText = (root: Node) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    if (current.nodeValue) current.nodeValue = stripBidi(current.nodeValue)
    current = walker.nextNode()
  }
}

const urlBearingAttribute = (name: string) => {
  const normalized = name.toLowerCase()
  if (
    normalized === 'href' ||
    normalized === 'src' ||
    normalized === 'xlink:href' ||
    normalized === 'srcset' ||
    normalized === 'poster' ||
    normalized === 'background' ||
    normalized === 'action' ||
    normalized === 'formaction' ||
    normalized === 'cite' ||
    normalized === 'ping' ||
    normalized === 'longdesc' ||
    normalized === 'usemap' ||
    normalized === 'data' ||
    normalized === 'codebase'
  ) {
    return true
  }
  return (
    normalized.endsWith(':href') ||
    normalized.endsWith(':src') ||
    normalized.endsWith(':srcset')
  )
}

const eventHandlerAttribute = (name: string) => name.startsWith('on')

const paintAttributes = new Set([
  'fill',
  'stroke',
  'filter',
  'clip-path',
  'mask',
  'mask-image',
  'marker',
  'marker-start',
  'marker-mid',
  'marker-end',
  'cursor',
  'color-profile',
])

const decodeCssEscapes = (value: string) =>
  value.replace(
    /\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\n\f\r])?|(\r\n|[\n\f\r])|(.))/gi,
    (_full, hex?: string, newline?: string, char?: string) => {
      if (hex) {
        const code = Number.parseInt(hex, 16)
        if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
          return '\uFFFD'
        }
        return String.fromCodePoint(code)
      }
      if (newline) return ''
      return char ?? ''
    },
  )

const embeddedUrls = (value: string) => {
  const found: string[] = []
  const pattern = /url\(\s*(?:(["'])([\s\S]*?)\1|([^)]*))\)/gi
  for (const match of value.matchAll(pattern)) {
    found.push((match[2] ?? match[3] ?? '').trim())
  }
  return found
}

const fragmentReference = (raw: string) => {
  const safe = safeUrl(raw)
  return safe !== null && safe.startsWith('#')
}

const fetchesOnInsert = (name: string, value: string) => {
  const decoded = decodeCssEscapes(value)
  if (/url\s*\(/i.test(decoded)) {
    const refs = embeddedUrls(decoded)
    if (refs.length === 0) return true
    return refs.some((ref) => !fragmentReference(ref))
  }
  if (!paintAttributes.has(name)) return false
  const trimmed = decoded.trim()
  if (!trimmed || /^#[0-9a-f]{3,8}$/i.test(trimmed)) return false
  if (fragmentReference(trimmed)) return false
  if (safeUrl(trimmed) !== null) return true
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true
  return /^(?:\/\/|\/|\.)/.test(trimmed)
}

const decodeEntities = (value: string) => {
  const holder = document.createElement('textarea')
  holder.innerHTML = value
  return holder.value
}

const compactUrl = (value: string) =>
  value.replace(controlChars, '').replace(/\s/g, '')

export const safeUrl = (raw: string) => {
  let current = compactUrl(raw)
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = compactUrl(decodeEntities(current))
    if (decoded === current) break
    current = decoded
  }
  const scheme = current.toLowerCase()
  if (
    scheme.startsWith('https:') ||
    scheme.startsWith('http:') ||
    scheme.startsWith('mailto:')
  ) {
    return current
  }
  if (current.startsWith('#')) return current
  return null
}

const readAttr = (source: string, name: string) => {
  const pattern = new RegExp(
    `${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  )
  const match = pattern.exec(source)
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? ''
}

const rewriteImages = (html: string) =>
  html.replace(/<img\b([^>]*)\/?\s*>/gi, (_full, attrs: string) => {
    const src = readAttr(attrs, 'src')
    const alt = readAttr(attrs, 'alt')
    const href = safeUrl(src)
    const label = escapeHtml(alt || src)
    if (!href) return label
    return `<a href="${escapeHtml(href)}">${label}</a>`
  })

const purify = DOMPurify(window)

purify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName !== 'input' || !(node instanceof Element)) return
  const type = (node.getAttribute('type') ?? '').toLowerCase()
  if (type !== 'checkbox') node.replaceWith(document.createTextNode(''))
})

purify.addHook('uponSanitizeAttribute', (node, data) => {
  const name = data.attrName.toLowerCase()
  if (name === 'data-md-slot') {
    const known = extensionSlots.has(data.attrValue)
    data.keepAttr = known
    data.forceKeepAttr = known
    return
  }
  if (eventHandlerAttribute(name) || fetchesOnInsert(name, data.attrValue)) {
    data.keepAttr = false
    return
  }
  if (
    name === 'style' ||
    name === 'src' ||
    name === 'srcset' ||
    name === 'poster' ||
    name === 'background' ||
    name === 'action' ||
    name === 'formaction'
  ) {
    data.keepAttr = false
    return
  }
  if (urlBearingAttribute(name)) {
    const href = safeUrl(data.attrValue)
    const anchorHref =
      name === 'href' && node.tagName.toUpperCase() === 'A' && href !== null
    data.keepAttr = anchorHref
    if (anchorHref && href) data.attrValue = href
    return
  }
  if (name === 'class') {
    const tag = node.tagName
    const classHost = tag === 'CODE' || tag === 'SPAN' || tag === 'DIV'
    data.keepAttr = classHost && /^language-[\w-]+$/.test(data.attrValue)
    return
  }
  if (name === 'align') {
    const cell = node.tagName === 'TH' || node.tagName === 'TD'
    data.keepAttr = cell && /^(left|center|right)$/i.test(data.attrValue)
    if (data.keepAttr) data.attrValue = data.attrValue.toLowerCase()
    return
  }
  if (name === 'dir') {
    data.keepAttr = /^(ltr|rtl|auto)$/i.test(data.attrValue)
    if (data.keepAttr) data.attrValue = data.attrValue.toLowerCase()
  }
})

purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = safeUrl(node.getAttribute('href') ?? '')
    if (!href) {
      const label = stripBidi(node.textContent ?? '')
      node.replaceWith(node.ownerDocument.createTextNode(label))
      return
    }
    node.setAttribute('href', href)
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
    return
  }
  if (node.tagName !== 'INPUT') return
  node.setAttribute('type', 'checkbox')
  node.setAttribute('disabled', '')
  for (const attribute of [...node.attributes]) {
    const name = attribute.name.toLowerCase()
    if (name !== 'type' && name !== 'checked' && name !== 'disabled') {
      node.removeAttribute(attribute.name)
    }
  }
})

const forbiddenTagSet = new Set(forbiddenTags)

const allowedTags = () => {
  const tags = new Set(baseTags)
  for (const tag of activeExtra?.tags ?? []) {
    const name = tag.toLowerCase()
    if (!forbiddenTagSet.has(name)) tags.add(name)
  }
  return [...tags]
}

const allowedAttributes = () => {
  const attributes = new Set<string>(baseAttributes)
  for (const attribute of activeExtra?.attributes ?? []) {
    const name = attribute.toLowerCase()
    if (
      eventHandlerAttribute(name) ||
      urlBearingAttribute(name) ||
      name === 'style'
    ) {
      continue
    }
    attributes.add(name)
  }
  return [...attributes]
}

const allowedNamespaces = () => [
  xhtmlNamespace,
  ...(activeExtra?.namespaces ?? []),
]

const expandExtensionSlots = (root: ParentNode) => {
  for (let guard = 0; guard < 32; guard += 1) {
    const node = root.querySelector('[data-md-slot]')
    if (!node) return
    const id = node.getAttribute('data-md-slot') ?? ''
    const inner = extensionSlots.get(id)
    extensionSlots.delete(id)
    node.removeAttribute('data-md-slot')
    if (inner) node.replaceWith(inner)
  }
}

const sanitizeFragment = (dirty: string, extra?: SanitizeExtra) => {
  const previous = activeExtra
  activeExtra = extra
  try {
    const fragment = purify.sanitize(rewriteImages(dirty), {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: allowedTags(),
      ALLOWED_ATTR: allowedAttributes(),
      ALLOWED_NAMESPACES: allowedNamespaces(),
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      KEEP_CONTENT: true,
      FORBID_TAGS: [...forbiddenTags],
      FORBID_ATTR: [
        'style',
        'src',
        'srcset',
        'poster',
        'background',
        'action',
        'formaction',
      ],
    }) as DocumentFragment
    dropUnsafe(fragment)
    expandExtensionSlots(fragment)
    return fragment
  } finally {
    activeExtra = previous
  }
}

export const holdExtensionHtml = (html: string, extra: SanitizeExtra) => {
  const clean = sanitizeFragment(html, extra)
  const id = crypto.randomUUID()
  extensionSlots.set(id, clean)
  return `<span data-md-slot="${id}"></span>`
}

export const discardExtensionSlots = () => {
  extensionSlots.clear()
}

const dropUnsafe = (fragment: DocumentFragment) => {
  fragment
    .querySelectorAll(forbiddenTags.join(','))
    .forEach((node) => node.remove())
  fragment.querySelectorAll('input').forEach((node) => {
    if (node.getAttribute('type') !== 'checkbox') {
      node.remove()
      return
    }
    node.setAttribute('disabled', '')
  })
  fragment.querySelectorAll('*').forEach((node) => {
    if (node.localName === 'image') {
      node.remove()
      return
    }
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase()
      if (
        eventHandlerAttribute(name) ||
        fetchesOnInsert(name, attribute.value) ||
        name === 'style' ||
        name === 'src' ||
        name === 'srcset' ||
        name === 'poster' ||
        name === 'background' ||
        name === 'action' ||
        name === 'formaction'
      ) {
        node.removeAttribute(attribute.name)
        continue
      }
      if (!urlBearingAttribute(name) || name === 'href') continue
      node.removeAttribute(attribute.name)
    }
    if (node.tagName.toUpperCase() !== 'A') return
    stripBidiText(node)
    const href = safeUrl(stripBidi(node.getAttribute('href') ?? ''))
    if (!href) {
      node.replaceWith(document.createTextNode(node.textContent ?? ''))
      return
    }
    node.setAttribute('href', href)
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  })
}

export const sanitizeHtml = (dirty: string) => sanitizeFragment(dirty)
