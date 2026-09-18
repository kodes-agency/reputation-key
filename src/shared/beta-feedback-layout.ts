// `masked_layout_v1` — what an optional Bug layout is allowed to be.
//
// BETA.md §3 permits media on a Bug with explicit per-submission consent,
// preview and removal, retained no more than 30 days. This is the shape that
// permission is spent on, and the shape is the privacy control.
//
// It is NOT a screenshot and NOT SVG bytes. It is a list of rectangles and a
// closed role vocabulary: numbers and enum members, nothing else. No text, no
// pixels, no URLs, no attribute values, no element names ever leave the page.
// Content-freeness is therefore structural rather than filtered — there is no
// field a marker could survive in, which is what the exfiltration canary
// asserts.
//
// The feedback path to monitoring deliberately clears both scopes so
// attachment state cannot hitchhike, and `scrubSentryEvent` deletes
// `attachments` outright. Rather than weaken either control, a captured layout
// stays first-party: `beta_feedback_masked_layouts`, expiring in at most 30
// days under a database CHECK and purged by the retention sweep.

import { z } from 'zod/v4'

/** Only what a layout diagnosis needs: what KIND of box sat where. */
const MASKED_LAYOUT_ROLES = [
  'text',
  'heading',
  'image',
  'media',
  'input',
  'button',
  'link',
  'container',
] as const

export type MaskedLayoutRole = (typeof MASKED_LAYOUT_ROLES)[number]

/** Bounded so one submission cannot become an upload channel by volume. */
export const MASKED_LAYOUT_MAX_BOXES = 240
const MAX_EXTENT = 20_000

const coordinate = z.int().min(-MAX_EXTENT).max(MAX_EXTENT)
const extent = z.int().min(0).max(MAX_EXTENT)

const maskedLayoutBoxSchema = z
  .object({
    x: coordinate,
    y: coordinate,
    w: extent,
    h: extent,
    role: z.enum(MASKED_LAYOUT_ROLES),
  })
  .strict()

export const maskedLayoutSchema = z
  .object({
    /** Viewport at capture, so the boxes can be rendered back to scale. */
    width: z.int().min(1).max(MAX_EXTENT),
    height: z.int().min(1).max(MAX_EXTENT),
    boxes: z.array(maskedLayoutBoxSchema).min(1).max(MASKED_LAYOUT_MAX_BOXES),
  })
  .strict()

export type MaskedLayout = z.infer<typeof maskedLayoutSchema>
export type MaskedLayoutBox = z.infer<typeof maskedLayoutBoxSchema>

/** The one retention horizon BETA.md §3 and the privacy notice both state. */
const MASKED_LAYOUT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export function maskedLayoutExpiry(capturedAt: Date): Date {
  return new Date(capturedAt.getTime() + MASKED_LAYOUT_RETENTION_MS)
}

const ROLE_FILL: Readonly<Record<MaskedLayoutRole, string>> = {
  text: '#94a3b8',
  heading: '#64748b',
  image: '#a78bfa',
  media: '#f472b6',
  input: '#38bdf8',
  button: '#34d399',
  link: '#60a5fa',
  container: '#cbd5f5',
}

function escapeAttribute(value: number): string {
  // Values are already integers from the schema; this keeps the renderer
  // honest if it is ever called with something unvalidated.
  return Number.isFinite(value) ? String(Math.trunc(value)) : '0'
}

/**
 * Render the geometry back to SVG for a human to look at — in the reporter's
 * preview before sending, and in the operator's render command afterwards.
 *
 * The SVG is BUILT here from validated numbers; it is never parsed, accepted or
 * transported. That direction matters: markup only ever leaves this function,
 * so there is nothing to sanitize.
 */
export function renderMaskedLayoutSvg(layout: MaskedLayout): string {
  // Containers are drawn as outlines and content as filled blocks, the way a
  // wireframe reads: structure first, then what sits inside it. Filling every
  // container instead stacks them into a flat wash that hides the layout.
  const rects = layout.boxes
    .map((box) => {
      const geometry =
        `x="${escapeAttribute(box.x)}" y="${escapeAttribute(box.y)}" ` +
        `width="${escapeAttribute(box.w)}" height="${escapeAttribute(box.h)}" rx="2"`
      return box.role === 'container'
        ? `<rect ${geometry} fill="none" stroke="${ROLE_FILL.container}" stroke-opacity="0.35" />`
        : `<rect ${geometry} fill="${ROLE_FILL[box.role]}" fill-opacity="0.7" />`
    })
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${escapeAttribute(layout.width)} ${escapeAttribute(layout.height)}" ` +
    `width="${escapeAttribute(layout.width)}" height="${escapeAttribute(layout.height)}" role="img" ` +
    `aria-label="Masked layout of the page, showing block positions only">` +
    `<rect width="100%" height="100%" fill="#0f172a" />${rects}</svg>`
  )
}

/** Counts per role, for the content-free summary triage sees in monitoring. */
export function summarizeMaskedLayout(layout: MaskedLayout): string {
  const counts = new Map<MaskedLayoutRole, number>()
  for (const box of layout.boxes) {
    counts.set(box.role, (counts.get(box.role) ?? 0) + 1)
  }
  const parts = MASKED_LAYOUT_ROLES.filter((role) => counts.has(role)).map(
    (role) => `${role}=${counts.get(role) ?? 0}`,
  )
  return `${layout.width}x${layout.height} ${parts.join(' ')}`
}
