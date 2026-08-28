import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'

export const PORTAL_HERO_UPLOAD_PURPOSE = 'hero_image' as const
export const PORTAL_HERO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
export const PORTAL_HERO_UPLOAD_TTL_MS = 15 * 60 * 1000

export const PORTAL_HERO_UPLOAD_CONTENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type PortalHeroUploadContentType = keyof typeof PORTAL_HERO_UPLOAD_CONTENT_TYPES

export type PortalUploadIssuanceState =
  'issued' | 'consumed' | 'finalized' | 'superseded' | 'rejected' | 'expired'

export type PortalUploadIssuance = Readonly<{
  id: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  purpose: typeof PORTAL_HERO_UPLOAD_PURPOSE
  objectKey: string
  contentType: PortalHeroUploadContentType
  declaredSizeBytes: number
  maxSizeBytes: number
  state: PortalUploadIssuanceState
  issuedAt: Date
  expiresAt: Date
  consumedAt: Date | null
  finalizedAt: Date | null
  supersededAt: Date | null
  rejectedAt: Date | null
  expiredAt: Date | null
  heroDerivativeKey: string | null
  thumbnailDerivativeKey: string | null
  heroImageUrl: string | null
  sourceDeletedAt: Date | null
  orphanDerivativesDeletedAt: Date | null
}>

export type PortalUploadObservedMetadata = Readonly<{
  contentType: string | null
  sizeBytes: number | null
  /**
   * Exact object version fence returned by S3. The processing fact persists
   * this value and every worker GET sends it as `If-Match`, so a later PUT to
   * the same private key cannot change the bytes being decoded.
   */
  sourceETag: string | null
}>

export function isSafePortalObjectETag(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9"'-]{1,200}$/.test(value)
}

export function isPortalHeroUploadContentType(
  contentType: string,
): contentType is PortalHeroUploadContentType {
  return contentType in PORTAL_HERO_UPLOAD_CONTENT_TYPES
}

/**
 * The browser never chooses or receives this key as API data. Its opaque
 * issuance identifier is the only caller-facing reference.
 */
export function portalHeroSourceObjectKey(
  issuanceId: string,
  contentType: PortalHeroUploadContentType,
): string {
  const extension = PORTAL_HERO_UPLOAD_CONTENT_TYPES[contentType]
  return `private/portal-uploads/${issuanceId}/source.${extension}`
}

export function expectedPortalHeroSourceObjectKey(
  issuance: Pick<PortalUploadIssuance, 'id' | 'contentType'>,
): string {
  return portalHeroSourceObjectKey(issuance.id, issuance.contentType)
}

export function createPortalHeroUploadIssuance(
  input: Readonly<{
    id: string
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId
    contentType: string
    declaredSizeBytes: number
    now: Date
  }>,
): PortalUploadIssuance | null {
  if (!isPortalHeroUploadContentType(input.contentType)) return null
  if (
    !Number.isSafeInteger(input.declaredSizeBytes) ||
    input.declaredSizeBytes < 1 ||
    input.declaredSizeBytes > PORTAL_HERO_UPLOAD_MAX_BYTES
  ) {
    return null
  }

  return {
    id: input.id,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    portalId: input.portalId,
    purpose: PORTAL_HERO_UPLOAD_PURPOSE,
    objectKey: portalHeroSourceObjectKey(input.id, input.contentType),
    contentType: input.contentType,
    declaredSizeBytes: input.declaredSizeBytes,
    maxSizeBytes: PORTAL_HERO_UPLOAD_MAX_BYTES,
    state: 'issued',
    issuedAt: input.now,
    expiresAt: new Date(input.now.getTime() + PORTAL_HERO_UPLOAD_TTL_MS),
    consumedAt: null,
    finalizedAt: null,
    supersededAt: null,
    rejectedAt: null,
    expiredAt: null,
    heroDerivativeKey: null,
    thumbnailDerivativeKey: null,
    heroImageUrl: null,
    sourceDeletedAt: null,
    orphanDerivativesDeletedAt: null,
  }
}

export function portalUploadMetadataMatches(
  issuance: PortalUploadIssuance,
  observed: PortalUploadObservedMetadata,
): boolean {
  return (
    issuance.objectKey === expectedPortalHeroSourceObjectKey(issuance) &&
    observed.contentType === issuance.contentType &&
    observed.sizeBytes === issuance.declaredSizeBytes &&
    observed.sizeBytes <= issuance.maxSizeBytes &&
    isSafePortalObjectETag(observed.sourceETag)
  )
}
