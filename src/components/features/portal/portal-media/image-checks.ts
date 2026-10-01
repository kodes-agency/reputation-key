// What a chosen picture is checked for before it is sent, as sentences for the
// list under the picture ("Large enough for every phone"). The browser knows the
// picture's real size (it decoded it), so the manager hears about a small or odd
// picture before anything is uploaded. The server checks again and is the only
// authority; these rules are the same numbers (`PORTAL_MEDIA_SIZE_RULES`).

import {
  PORTAL_MEDIA_MAX_UPLOAD_BYTES,
  PORTAL_MEDIA_SIZE_RULES,
  portalMediaSizeProblem,
  type PortalMediaPurpose,
} from '#/shared/domain/portal-media'
import { isAcceptedPortalImageType } from './upload-portal-image'

export type ImageFacts = Readonly<{
  /** The browser's name for the file's type, e.g. `image/jpeg`. */
  type: string
  bytes: number
  /** The picture as it is shown: its orientation already applied. */
  width: number
  height: number
}>

export type ImageCheck = Readonly<{
  id: 'size' | 'shape' | 'format'
  passed: boolean
  label: string
}>

const BYTES_PER_MB = 1024 * 1024
const MAX_MB = PORTAL_MEDIA_MAX_UPLOAD_BYTES / BYTES_PER_MB

/** "4032 × 3024 · 3.2 MB", for the line under a chosen picture's name. */
export function describeImageFacts(facts: ImageFacts): string {
  const size =
    facts.bytes >= BYTES_PER_MB
      ? `${Math.round((facts.bytes / BYTES_PER_MB) * 10) / 10} MB`
      : `${Math.max(1, Math.round(facts.bytes / 1024))} KB`
  return `${facts.width} × ${facts.height} · ${size}`
}

const SIZE_LABELS: Readonly<
  Record<PortalMediaPurpose, Readonly<{ ok: string; short: string }>>
> = {
  hero: {
    ok: 'Large enough for every phone',
    short: 'Too small to stay sharp on a phone',
  },
  logo: {
    ok: 'Large enough to stay sharp',
    short: 'Too small to stay sharp',
  },
  link_image: {
    ok: 'Large enough for a tile',
    short: 'Too small for a tile',
  },
}

function sizeCheck(purpose: PortalMediaPurpose, facts: ImageFacts): ImageCheck {
  const rule = PORTAL_MEDIA_SIZE_RULES[purpose]
  const labels = SIZE_LABELS[purpose]
  const needs = `needs ${rule.minLongEdge} px on the long side and ${rule.minShortEdge} px on the short`
  const isSmall =
    portalMediaSizeProblem(purpose, facts.width, facts.height) === 'too_small'
  return {
    id: 'size',
    passed: !isSmall,
    label: `${isSmall ? labels.short : labels.ok} (${needs})`,
  }
}

function shapeCheck(purpose: PortalMediaPurpose, facts: ImageFacts): ImageCheck | null {
  const isExtreme =
    portalMediaSizeProblem(purpose, facts.width, facts.height) === 'extreme_aspect'
  if (!isExtreme) return null
  const ratio = PORTAL_MEDIA_SIZE_RULES[purpose].maxAspectRatio
  return {
    id: 'shape',
    passed: false,
    label: `Too wide or too tall (the long side may be at most ${ratio} times the short)`,
  }
}

function formatCheck(facts: ImageFacts): ImageCheck {
  if (!isAcceptedPortalImageType(facts.type)) {
    return { id: 'format', passed: false, label: 'Use a JPEG, PNG or WebP file' }
  }
  if (facts.bytes > PORTAL_MEDIA_MAX_UPLOAD_BYTES) {
    return { id: 'format', passed: false, label: `Over ${MAX_MB} MB` }
  }
  return { id: 'format', passed: true, label: `JPG, PNG or WebP, up to ${MAX_MB} MB` }
}

/**
 * The checks for a picture, in the order they are listed. Size and format are
 * always shown, so a good picture reads as passing them; the shape is shown only
 * when it is the problem.
 */
export function checkImageFacts(
  purpose: PortalMediaPurpose,
  facts: ImageFacts,
): readonly ImageCheck[] {
  return [
    sizeCheck(purpose, facts),
    shapeCheck(purpose, facts),
    formatCheck(facts),
  ].filter((check): check is ImageCheck => check !== null)
}

export const allImageChecksPass = (checks: readonly ImageCheck[]): boolean =>
  checks.every((check) => check.passed)
