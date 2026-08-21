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
  /**
   * Org-scoped snippet read for cross-context lookups (inbox item rendering).
   *
   * Deliberately NOT scoped to a property or portal, unlike every other read
   * here: an inbox item carries only its organization and the response id, and
   * the organization is the tenant boundary that matters for it. Returns the
   * shared fields only — never a session id, IP hash, or media reference.
   *
   * A withdrawn or deleted response returns null: its content is gone, so the
   * inbox item must render as unavailable rather than as an empty comment.
   */
  findSnippetForOrg(
    organizationId: string,
    responseId: string,
  ): Promise<Readonly<{ comment: string | null; ratingValue: number | null }> | null>
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
