import type { GuestResponse } from './guest-response'

export const MAX_GUEST_MEDIA_BYTES = 10 * 1024 * 1024
export const GUEST_MEDIA_ISSUANCE_MS = 15 * 60 * 1000

export const GUEST_MEDIA_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type GuestMediaContentType = keyof typeof GUEST_MEDIA_TYPES
export type GuestMediaStatus =
  | 'issued'
  | 'processing'
  | 'ready'
  | 'purge_pending'
  | 'deleted'
  | 'quarantined'
  | 'expired'

export type GuestMedia = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  portalId: string
  responseId: string
  sessionId: string
  objectKey: string
  contentType: GuestMediaContentType
  declaredSizeBytes: number
  status: GuestMediaStatus
  expiresAt: Date
  confirmedAt: Date | null
  processingLease: string | null
  processingStartedAt: Date | null
  publicUrl: string | null
  readyAt: Date | null
  deletedAt: Date | null
}>

export type GuestMediaError =
  | { code: 'unsupported_media_type' }
  | { code: 'invalid_media_size' }
  | { code: 'response_not_processable' }
  | { code: 'media_expired' }
  | { code: 'media_not_issued' }
  | { code: 'processing_lease_mismatch' }

const canOwnMedia = (response: GuestResponse) =>
  (response.status === 'submitted' || response.status === 'corrected') &&
  response.mediaConsent

export function issueGuestMedia(
  response: GuestResponse,
  input: Readonly<{ id: string; contentType: string; sizeBytes: number }>,
  now: Date,
): GuestMedia | GuestMediaError {
  if (!canOwnMedia(response)) return { code: 'response_not_processable' }
  if (!(input.contentType in GUEST_MEDIA_TYPES)) {
    return { code: 'unsupported_media_type' }
  }
  if (
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes < 1 ||
    input.sizeBytes > MAX_GUEST_MEDIA_BYTES
  ) {
    return { code: 'invalid_media_size' }
  }

  const contentType = input.contentType as GuestMediaContentType
  const extension = GUEST_MEDIA_TYPES[contentType]
  return {
    id: input.id,
    organizationId: response.organizationId,
    propertyId: response.propertyId,
    portalId: response.portalId,
    responseId: response.id,
    sessionId: response.sessionId,
    objectKey: `guest/${response.organizationId}/${response.portalId}/${response.id}/${input.id}.${extension}`,
    contentType,
    declaredSizeBytes: input.sizeBytes,
    status: 'issued',
    expiresAt: new Date(now.getTime() + GUEST_MEDIA_ISSUANCE_MS),
    confirmedAt: null,
    processingLease: null,
    processingStartedAt: null,
    publicUrl: null,
    readyAt: null,
    deletedAt: null,
  }
}

export function claimMediaForProcessing(
  media: GuestMedia,
  response: GuestResponse,
  lease: string,
  now: Date,
): GuestMedia | GuestMediaError {
  if (!canOwnMedia(response) || response.id !== media.responseId) {
    return { code: 'response_not_processable' }
  }
  if (media.status !== 'issued') return { code: 'media_not_issued' }
  if (now >= media.expiresAt) return { code: 'media_expired' }
  return {
    ...media,
    status: 'processing',
    confirmedAt: now,
    processingLease: lease,
    processingStartedAt: now,
  }
}

export function completeMediaProcessing(
  media: GuestMedia,
  response: GuestResponse,
  lease: string,
  publicUrl: string,
  now: Date,
): Readonly<{ media: GuestMedia; deleteObject: boolean }> {
  if (
    media.status !== 'processing' ||
    media.processingLease !== lease ||
    !canOwnMedia(response) ||
    response.id !== media.responseId
  ) {
    return { media: markMediaForPurge(media, now), deleteObject: true }
  }
  return {
    media: {
      ...media,
      status: 'ready',
      processingLease: null,
      publicUrl,
      readyAt: now,
    },
    deleteObject: false,
  }
}

export function markMediaForPurge(media: GuestMedia, now: Date): GuestMedia {
  if (media.status === 'deleted') return media
  return {
    ...media,
    status: 'purge_pending',
    processingLease: null,
    publicUrl: null,
    readyAt: null,
    deletedAt: media.deletedAt ?? now,
  }
}
