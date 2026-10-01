// Portal context — the image policy: what an upload may be, and what it becomes.
//
// Pure: no I/O, no decoder, no throws. A decoder (the sharp adapter) reports
// facts about the bytes; this module decides. Every accepted upload is decoded
// and re-encoded, so what a guest is served is a WebP this system made, never
// the bytes a manager sent: metadata, trailing data and anything hidden in
// chunks or segments do not survive. The policy therefore only has to decide
// what is worth decoding and how large the result is.
//
// Accepted: JPEG, PNG and WebP, still images only. Not accepted: SVG (a
// document, not a picture), GIF and animated PNG or WebP (this page has no
// motion), HEIC and AVIF (no decoder we are willing to expose to uploads).

import { err, ok } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import {
  PORTAL_MEDIA_PURPOSES,
  PORTAL_MEDIA_STORED_CONTENT_TYPE,
  type PortalMediaPurpose,
  type PortalMediaSourceFormat,
} from '#/shared/domain/portal-media'
import { portalError, type PortalError } from './errors'

export const PORTAL_IMAGE_PURPOSES = PORTAL_MEDIA_PURPOSES
export type PortalImagePurpose = PortalMediaPurpose

export type PortalImageFormat = PortalMediaSourceFormat

/** Why an image was refused. A closed set: it is shown to the manager and counted. */
export type PortalImageRejectionReason =
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  | 'type_mismatch'
  | 'animated'
  | 'too_many_pixels'
  | 'too_small'
  | 'extreme_aspect'
  | 'undecodable'
  | 'output_too_large'
  | 'rights_not_confirmed'
  | 'asset_limit_reached'

type PurposeRule = Readonly<{
  /** The longest side of the stored image; larger uploads are scaled down to it. */
  maxEdge: number
  /** An upload whose longest side is shorter than this is too small to be sharp. */
  minLongEdge: number
  minShortEdge: number
  /** Longest side over shortest side. */
  maxAspectRatio: number
  maxOutputBytes: number
  /** WebP quality, 1 to 100. */
  quality: number
  /** Whether a transparent background is kept (a logo or tile icon) or flattened. */
  allowsAlpha: boolean
}>

const MIB = 1024 * 1024

export const PORTAL_IMAGE_LIMITS = Object.freeze({
  /**
   * The largest body accepted. Chosen at 10 MiB: a phone photograph is 2 to 6,
   * and it is the ceiling the retired hero upload used.
   */
  maxUploadBytes: 10 * MIB,
  /**
   * The most pixels the decoder is asked to hold. 40 million decodes to about
   * 160 MB of RGBA, which is the largest allocation an upload can cause.
   */
  maxInputPixels: 40_000_000,
  /** Matches the snapshot's media dimension limit and WebP's own ceiling. */
  maxInputEdge: 16_384,
  purposes: {
    hero: {
      maxEdge: 2400,
      minLongEdge: 1000,
      minShortEdge: 500,
      maxAspectRatio: 4,
      maxOutputBytes: 3 * MIB,
      quality: 82,
      allowsAlpha: false,
    },
    logo: {
      maxEdge: 800,
      minLongEdge: 128,
      minShortEdge: 32,
      maxAspectRatio: 8,
      maxOutputBytes: 1 * MIB,
      quality: 90,
      allowsAlpha: true,
    },
    link_image: {
      maxEdge: 1200,
      minLongEdge: 200,
      minShortEdge: 100,
      maxAspectRatio: 4,
      maxOutputBytes: 1.5 * MIB,
      quality: 80,
      allowsAlpha: true,
    },
  } as const satisfies Readonly<Record<PortalImagePurpose, PurposeRule>>,
})

export const PORTAL_IMAGE_OUTPUT_CONTENT_TYPE = PORTAL_MEDIA_STORED_CONTENT_TYPE

/** The one error code every refusal uses; the reason is the only thing it carries. */
export const portalImageRejection = (reason: PortalImageRejectionReason): PortalError =>
  portalError('image_rejected', `The image was refused: ${reason}`, { reason })

// ── Sniffing ──────────────────────────────────────────────────────

const CONTENT_TYPE_OF: Readonly<Record<PortalImageFormat, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const startsWith = (body: Uint8Array, prefix: readonly number[], offset = 0): boolean =>
  body.length >= offset + prefix.length &&
  prefix.every((value, index) => body[offset + index] === value)

const fourCc = (body: Uint8Array, offset: number): string =>
  body.length >= offset + 4
    ? String.fromCharCode(
        body[offset] ?? 0,
        body[offset + 1] ?? 0,
        body[offset + 2] ?? 0,
        body[offset + 3] ?? 0,
      )
    : ''

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

/** The format named by the leading bytes, or null for anything else. */
export function sniffImageFormat(body: Uint8Array): PortalImageFormat | null {
  if (startsWith(body, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(body, PNG_SIGNATURE)) return 'png'
  if (fourCc(body, 0) === 'RIFF' && fourCc(body, 8) === 'WEBP') return 'webp'
  return null
}

const MAX_PNG_CHUNKS_SCANNED = 64

function isAnimatedPng(body: Uint8Array): boolean {
  let offset = PNG_SIGNATURE.length
  for (let scanned = 0; scanned < MAX_PNG_CHUNKS_SCANNED; scanned += 1) {
    if (body.length < offset + 8) return false
    const length =
      ((body[offset] ?? 0) * 0x1000000 +
        ((body[offset + 1] ?? 0) << 16) +
        ((body[offset + 2] ?? 0) << 8) +
        (body[offset + 3] ?? 0)) >>>
      0
    const type = fourCc(body, offset + 4)
    // The animation control chunk must precede the first image data chunk.
    if (type === 'acTL') return true
    if (type === 'IDAT' || type === 'IEND') return false
    offset += 12 + length
  }
  return false
}

const WEBP_ANIMATION_FLAG = 0x02

function isAnimatedWebp(body: Uint8Array): boolean {
  // RIFF header (12 bytes), then the first chunk: fourcc, size, payload. Only
  // an extended (VP8X) file can be animated; its first payload byte is flags.
  return fourCc(body, 12) === 'VP8X' && ((body[20] ?? 0) & WEBP_ANIMATION_FLAG) !== 0
}

/** Whether the bytes are an animated PNG or WebP. A JPEG never is. */
export function isAnimatedImage(body: Uint8Array, format: PortalImageFormat): boolean {
  if (format === 'png') return isAnimatedPng(body)
  if (format === 'webp') return isAnimatedWebp(body)
  return false
}

// ── The three decisions ───────────────────────────────────────────

const declaredFormat = (declaredContentType: string): PortalImageFormat | null => {
  const base = declaredContentType.split(';')[0]?.trim().toLowerCase() ?? ''
  const found = (Object.entries(CONTENT_TYPE_OF) as [PortalImageFormat, string][]).find(
    ([, contentType]) => contentType === base,
  )
  return found ? found[0] : null
}

/**
 * The decision made before any decoder sees the bytes: size, format and agreement
 * between what the browser said and what the bytes are.
 */
export function assessUpload(
  input: Readonly<{ declaredContentType: string; bytes: Uint8Array }>,
): Result<PortalImageFormat, PortalError> {
  const { bytes } = input
  if (bytes.length === 0) return err(portalImageRejection('empty'))
  if (bytes.length > PORTAL_IMAGE_LIMITS.maxUploadBytes) {
    return err(portalImageRejection('too_large'))
  }
  const declared = declaredFormat(input.declaredContentType)
  if (declared === null) return err(portalImageRejection('unsupported_type'))
  const sniffed = sniffImageFormat(bytes)
  if (sniffed === null) return err(portalImageRejection('unsupported_type'))
  if (sniffed !== declared) return err(portalImageRejection('type_mismatch'))
  if (isAnimatedImage(bytes, sniffed)) return err(portalImageRejection('animated'))
  return ok(sniffed)
}

/** What a decoder reports about the uploaded bytes without decoding their pixels. */
export type ImageFacts = Readonly<{
  /** The decoder's own name for the format, e.g. 'jpeg'. */
  format: string
  width: number
  height: number
  /** Frames: more than one is an animation. */
  pages: number
  /** EXIF orientation, 1 to 8, or null when the image carries none. */
  orientation: number | null
  hasAlpha: boolean
}>

export type ReencodePlan = Readonly<{
  /** The stored size, after the orientation has been applied. */
  width: number
  height: number
  quality: number
  keepAlpha: boolean
  contentType: typeof PORTAL_IMAGE_OUTPUT_CONTENT_TYPE
}>

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 1

/** EXIF orientations 5 to 8 display the image turned a quarter: sides swap. */
const displayedSides = (facts: ImageFacts): readonly [number, number] =>
  facts.orientation !== null && facts.orientation >= 5 && facts.orientation <= 8
    ? [facts.height, facts.width]
    : [facts.width, facts.height]

const isAcceptedFormat = (format: string): format is PortalImageFormat =>
  format === 'jpeg' || format === 'png' || format === 'webp'

/**
 * The decision made from the decoder's facts: is this image worth re-encoding,
 * and at what size. The plan is exact so the stored dimensions are known in
 * advance and checked again on the result.
 */
export function planReencode(
  purpose: PortalImagePurpose,
  facts: ImageFacts,
): Result<ReencodePlan, PortalError> {
  const limits = PORTAL_IMAGE_LIMITS
  if (!isAcceptedFormat(facts.format))
    return err(portalImageRejection('unsupported_type'))
  if (facts.pages > 1) return err(portalImageRejection('animated'))
  if (!isPositiveInteger(facts.width) || !isPositiveInteger(facts.height)) {
    return err(portalImageRejection('undecodable'))
  }
  if (
    facts.width > limits.maxInputEdge ||
    facts.height > limits.maxInputEdge ||
    facts.width * facts.height > limits.maxInputPixels
  ) {
    return err(portalImageRejection('too_many_pixels'))
  }

  const rule: PurposeRule = limits.purposes[purpose]
  const [width, height] = displayedSides(facts)
  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)
  if (longEdge < rule.minLongEdge || shortEdge < rule.minShortEdge) {
    return err(portalImageRejection('too_small'))
  }
  if (longEdge / shortEdge > rule.maxAspectRatio) {
    return err(portalImageRejection('extreme_aspect'))
  }

  const scale = longEdge > rule.maxEdge ? rule.maxEdge / longEdge : 1
  return ok({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: rule.quality,
    keepAlpha: rule.allowsAlpha && facts.hasAlpha,
    contentType: PORTAL_IMAGE_OUTPUT_CONTENT_TYPE,
  })
}

export type EncodedImage = Readonly<{
  bytes: Uint8Array
  width: number
  height: number
}>

/**
 * The decision made on the encoder's output, before anything is stored: it is
 * a WebP, it is the size that was planned, and it fits the purpose's budget.
 */
export function assessEncodedImage(
  purpose: PortalImagePurpose,
  plan: ReencodePlan,
  encoded: EncodedImage,
): Result<EncodedImage, PortalError> {
  if (
    sniffImageFormat(encoded.bytes) !== 'webp' ||
    encoded.width !== plan.width ||
    encoded.height !== plan.height
  ) {
    return err(portalImageRejection('undecodable'))
  }
  if (encoded.bytes.length > PORTAL_IMAGE_LIMITS.purposes[purpose].maxOutputBytes) {
    return err(portalImageRejection('output_too_large'))
  }
  return ok(encoded)
}
