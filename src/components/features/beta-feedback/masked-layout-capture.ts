import type { MaskedLayoutSnapshot } from '#/shared/beta-feedback-contract'
import {
  buildMaskedLayoutSnapshot,
  type MaskedLayoutBlockKind,
  type MaskedLayoutCandidate,
} from '#/shared/masked-layout-snapshot'

const INPUT_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'])
const IMAGE_TAGS = new Set(['CANVAS', 'IMG', 'PICTURE', 'SVG'])
const MEDIA_TAGS = new Set(['AUDIO', 'EMBED', 'IFRAME', 'OBJECT', 'VIDEO'])
const TEXT_TAGS = new Set([
  'A',
  'CODE',
  'DD',
  'DT',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LABEL',
  'LI',
  'P',
  'PRE',
  'SMALL',
  'SPAN',
  'STRONG',
  'TD',
  'TH',
])
const SURFACE_TAGS = new Set([
  'ARTICLE',
  'ASIDE',
  'FOOTER',
  'HEADER',
  'MAIN',
  'NAV',
  'SECTION',
])

function kindForElement(element: Element): MaskedLayoutBlockKind | null {
  if (INPUT_TAGS.has(element.tagName) || element.hasAttribute('contenteditable')) {
    return 'input'
  }
  if (IMAGE_TAGS.has(element.tagName)) return 'image'
  if (MEDIA_TAGS.has(element.tagName)) return 'media'
  if (TEXT_TAGS.has(element.tagName)) return 'text'
  if (
    SURFACE_TAGS.has(element.tagName) ||
    element.getAttribute('role') === 'region' ||
    element.hasAttribute('data-slot')
  ) {
    return 'surface'
  }
  return null
}

function visibleCandidate(element: Element): MaskedLayoutCandidate | null {
  if (element.closest('[data-beta-feedback-capture-exclude]')) return null
  const style = window.getComputedStyle(element)
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    Number(style.opacity) === 0
  ) {
    return null
  }
  const kind = kindForElement(element)
  if (!kind) return null
  const rect = element.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return null
  return {
    kind,
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  }
}

/**
 * Called only from the manager's explicit opt-in click. It reads geometry and
 * semantic element kinds from the authenticated page under `main`; it never
 * reads DOM text, attributes containing content, input values, pixels, URLs,
 * computed colors, or media bytes.
 */
export function captureMaskedLayoutSnapshot(): MaskedLayoutSnapshot {
  const root = document.querySelector('main')
  const elements = root ? [root, ...root.querySelectorAll('*')] : []
  const candidates: MaskedLayoutCandidate[] = []
  for (const element of elements.slice(0, 1_000)) {
    const candidate = visibleCandidate(element)
    if (candidate) candidates.push(candidate)
  }
  return buildMaskedLayoutSnapshot(candidates, {
    width: window.innerWidth,
    height: window.innerHeight,
  })
}
