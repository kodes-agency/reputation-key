import { sha256Hex } from '#/shared/domain/sha256'
import type { StarRating } from './types'

export const REVIEW_MATERIAL_NORMALIZATION_VERSION = 'review-material-v1' as const

export type ReviewMaterialComparison =
  | 'initial_material_revision'
  | 'unchanged'
  | 'material_change'
  | 'normalization_shadow_match'
  | 'baseline_unavailable'

export type ReviewMaterialDescription = Readonly<{
  rating: StarRating
  originalText: string | null
  normalizedText: string | null
  normalizationVersion: typeof REVIEW_MATERIAL_NORMALIZATION_VERSION
  sourceDigest: string
  normalizedDigest: string
}>

export type PreviousReviewMaterial = Readonly<{
  materialRevision: number
  normalizationVersion: string
  sourceDigest: string | null
  normalizedDigest: string | null
  rating: StarRating | null
  originalText: string | null
}>

export type MaterialReviewComparisonResult = ReviewMaterialDescription &
  Readonly<{
    comparison: ReviewMaterialComparison
    materialRevision: number
    createsMaterialRevision: boolean
  }>

function canonicalField(value: string | null): string {
  return value == null ? 'null' : `text:${value.length}:${value}`
}

function canonicalDate(value: Date | null): string {
  return value == null ? 'null' : `date:${value.toISOString()}`
}

/**
 * Version 1 comparison form for the guest's original text.
 *
 * Unicode is NFC-normalized and every Unicode whitespace run is represented
 * by one ASCII space. Case and punctuation remain significant. Empty or
 * whitespace-only source text is represented as no text.
 */
export function normalizeOriginalReviewText(text: string | null): string | null {
  if (text == null) return null
  const normalized = text
    .normalize('NFC')
    .replace(/\p{White_Space}+/gu, ' ')
    .trim()
  return normalized.length === 0 ? null : normalized
}

export function describeReviewMaterial(
  input: Readonly<{ rating: StarRating; text: string | null }>,
): ReviewMaterialDescription {
  const normalizedText = normalizeOriginalReviewText(input.text)
  return Object.freeze({
    rating: input.rating,
    originalText: input.text,
    normalizedText,
    normalizationVersion: REVIEW_MATERIAL_NORMALIZATION_VERSION,
    sourceDigest: sha256Hex(
      `repkey-review-material-source-v1\0${input.rating}\0${canonicalField(input.text)}`,
    ),
    normalizedDigest: sha256Hex(
      `repkey-review-material-normalized-v1\0${input.rating}\0${canonicalField(normalizedText)}`,
    ),
  })
}

/** A content-state digest used to make replayed provider observations idempotent. */
export function computeReviewSourceObservationDigest(
  input: Readonly<{
    rating: StarRating
    text: string | null
    translatedText: string | null
    languageCode: string | null
    reviewerName: string | null
    reviewerProfilePhotoUrl: string | null
    reviewedAt: Date
    sourceCreatedAt: Date | null
    sourceUpdatedAt: Date | null
  }>,
): string {
  const fields = [
    String(input.rating),
    canonicalField(input.text),
    canonicalField(input.translatedText),
    canonicalField(input.languageCode),
    canonicalField(input.reviewerName),
    canonicalField(input.reviewerProfilePhotoUrl),
    canonicalDate(input.reviewedAt),
    canonicalDate(input.sourceCreatedAt),
    canonicalDate(input.sourceUpdatedAt),
  ]
  return sha256Hex(`repkey-review-source-observation-v1\0${fields.join('\0')}`)
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

/**
 * Compare one provider observation with the current material head.
 *
 * A legacy normalization baseline is first evaluated in shadow with the new
 * algorithm. If source content has already been erased and the old baseline
 * has no comparable digest, the existing revision is retained: a policy
 * transition must never be presented as a guest edit.
 */
export function compareMaterialReviewRevision(
  input: Readonly<{
    previous: PreviousReviewMaterial | null
    incoming: Readonly<{ rating: StarRating; text: string | null }>
  }>,
): MaterialReviewComparisonResult {
  const material = describeReviewMaterial(input.incoming)
  if (input.previous == null) {
    return Object.freeze({
      ...material,
      comparison: 'initial_material_revision',
      materialRevision: 1,
      createsMaterialRevision: true,
    })
  }
  if (!isPositiveSafeInteger(input.previous.materialRevision)) {
    throw new TypeError('Previous material revision must be a positive safe integer')
  }

  if (
    input.previous.normalizationVersion === REVIEW_MATERIAL_NORMALIZATION_VERSION &&
    input.previous.normalizedDigest != null
  ) {
    const unchanged = input.previous.normalizedDigest === material.normalizedDigest
    return Object.freeze({
      ...material,
      comparison: unchanged ? 'unchanged' : 'material_change',
      materialRevision: unchanged
        ? input.previous.materialRevision
        : input.previous.materialRevision + 1,
      createsMaterialRevision: !unchanged,
    })
  }

  if (input.previous.rating == null) {
    return Object.freeze({
      ...material,
      comparison: 'baseline_unavailable',
      materialRevision: input.previous.materialRevision,
      createsMaterialRevision: false,
    })
  }

  const previousUnderCurrentVersion = describeReviewMaterial({
    rating: input.previous.rating,
    text: input.previous.originalText,
  })
  const unchanged =
    previousUnderCurrentVersion.normalizedDigest === material.normalizedDigest
  return Object.freeze({
    ...material,
    comparison: unchanged ? 'normalization_shadow_match' : 'material_change',
    materialRevision: unchanged
      ? input.previous.materialRevision
      : input.previous.materialRevision + 1,
    createsMaterialRevision: !unchanged,
  })
}
