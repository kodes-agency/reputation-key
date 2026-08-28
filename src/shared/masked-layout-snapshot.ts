import {
  MASKED_LAYOUT_GRID_WIDTH,
  MASKED_LAYOUT_MAX_BLOCKS,
  maskedLayoutSnapshotSchema,
  type MaskedLayoutSnapshot,
} from './beta-feedback-contract'

export type MaskedLayoutBlockKind = MaskedLayoutSnapshot['blocks'][number]['kind']

export type MaskedLayoutCandidate = Readonly<{
  kind: MaskedLayoutBlockKind
  left: number
  top: number
  right: number
  bottom: number
}>

type Viewport = Readonly<{ width: number; height: number }>

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

function safeViewport(viewport: Viewport): Viewport {
  return {
    width: clamp(Math.round(viewport.width) || 1, 1, 8_192),
    height: clamp(Math.round(viewport.height) || 1, 1, 8_192),
  }
}

/**
 * Convert visible browser rectangles into a deliberately low-resolution
 * wireframe. No DOM text, attribute, URL, input value, pixel, or style value
 * enters the result.
 */
export function buildMaskedLayoutSnapshot(
  candidates: readonly MaskedLayoutCandidate[],
  viewportInput: Viewport,
): MaskedLayoutSnapshot {
  const viewport = safeViewport(viewportInput)
  const gridHeight = clamp(
    Math.ceil((viewport.height / viewport.width) * MASKED_LAYOUT_GRID_WIDTH),
    24,
    MASKED_LAYOUT_GRID_WIDTH,
  )
  const seen = new Set<string>()
  const blocks: MaskedLayoutSnapshot['blocks'][number][] = []

  for (const candidate of candidates) {
    if (blocks.length >= MASKED_LAYOUT_MAX_BLOCKS) break
    const left = clamp(Math.min(candidate.left, candidate.right), 0, viewport.width)
    const top = clamp(Math.min(candidate.top, candidate.bottom), 0, viewport.height)
    const right = clamp(Math.max(candidate.left, candidate.right), 0, viewport.width)
    const bottom = clamp(Math.max(candidate.top, candidate.bottom), 0, viewport.height)
    if (![left, top, right, bottom].every(Number.isFinite)) continue
    if (right - left < 2 || bottom - top < 2) continue

    const x = clamp(
      Math.floor((left / viewport.width) * MASKED_LAYOUT_GRID_WIDTH),
      0,
      MASKED_LAYOUT_GRID_WIDTH - 1,
    )
    const y = clamp(Math.floor((top / viewport.height) * gridHeight), 0, gridHeight - 1)
    const blockRight = clamp(
      Math.ceil((right / viewport.width) * MASKED_LAYOUT_GRID_WIDTH),
      x + 1,
      MASKED_LAYOUT_GRID_WIDTH,
    )
    const blockBottom = clamp(
      Math.ceil((bottom / viewport.height) * gridHeight),
      y + 1,
      gridHeight,
    )
    const block = {
      kind: candidate.kind,
      x,
      y,
      width: blockRight - x,
      height: blockBottom - y,
    } as const
    const key = `${block.kind}:${block.x}:${block.y}:${block.width}:${block.height}`
    if (seen.has(key)) continue
    seen.add(key)
    blocks.push(block)
  }

  // A consented empty page is still represented by one neutral viewport
  // surface so the server receives a valid, useful, bounded preview.
  if (blocks.length === 0) {
    blocks.push({
      kind: 'surface',
      x: 0,
      y: 0,
      width: MASKED_LAYOUT_GRID_WIDTH,
      height: gridHeight,
    })
  }

  return maskedLayoutSnapshotSchema.parse({
    profile: 'masked-layout-v1',
    consented: true,
    gridWidth: MASKED_LAYOUT_GRID_WIDTH,
    gridHeight,
    blocks,
  })
}

const FILL_BY_KIND: Readonly<Record<MaskedLayoutBlockKind, string>> = {
  surface: '#e2e8f0',
  text: '#64748b',
  input: '#94a3b8',
  image: '#cbd5e1',
  media: '#a8b3c2',
}

/**
 * Server-authoritative attachment renderer. The SVG vocabulary is closed and
 * consists only of fixed strings plus validated small integers.
 */
export function renderMaskedLayoutSvg(snapshotInput: MaskedLayoutSnapshot): string {
  const snapshot = maskedLayoutSnapshotSchema.parse(snapshotInput)
  const rectangles = snapshot.blocks
    .map(
      (block) =>
        `<rect data-mask-kind="${block.kind}" x="${String(block.x)}" y="${String(block.y)}" width="${String(block.width)}" height="${String(block.height)}" rx="1" fill="${FILL_BY_KIND[block.kind]}"/>`,
    )
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(snapshot.gridWidth)} ${String(snapshot.gridHeight)}" role="img"><title>Masked layout preview</title><rect width="100%" height="100%" fill="#f8fafc"/>${rectangles}</svg>`
}
