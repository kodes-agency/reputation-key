import type { GuestMedia } from '../../domain/guest-media'
import type { GuestResponse } from '../../domain/guest-response'

export type GuestResponseScope = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
}>

export type GuestResponseRepository = Readonly<{
  findForSession(
    scope: GuestResponseScope,
    sessionId: string,
  ): Promise<GuestResponse | null>
  findById(scope: GuestResponseScope, responseId: string): Promise<GuestResponse | null>
  insertSubmitted(response: GuestResponse): Promise<boolean>
  saveCorrection(response: GuestResponse): Promise<boolean>
  saveModeration(response: GuestResponse): Promise<boolean>
  deleteAndQueueMediaPurge(response: GuestResponse): Promise<ReadonlyArray<string>>
  insertMedia(media: GuestMedia): Promise<boolean>
  findMediaForSession(
    scope: GuestResponseScope,
    sessionId: string,
    mediaId: string,
  ): Promise<GuestMedia | null>
  claimMedia(media: GuestMedia, lease: string, now: Date): Promise<boolean>
  completeMedia(
    media: GuestMedia,
    lease: string,
    publicUrl: string,
    now: Date,
  ): Promise<boolean>
  queueMediaPurge(media: GuestMedia, now: Date): Promise<void>
  markMediaDeleted(scope: GuestResponseScope, objectKey: string, now: Date): Promise<void>
}>
