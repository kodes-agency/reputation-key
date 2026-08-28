// Portal context — domain events
// Per architecture: "Events are facts, named in the past tense."
// Events live in their owning context's domain/events.ts.

import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
import type { PortalId } from './types'
import type {
  OrganizationId,
  PortalGroupId,
  PortalLinkCategoryId,
  PortalLinkId,
  PortalAccessArtifactId,
  PortalApprovedDestinationId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import { portalError } from './errors'
import type { PortalPublicationState } from './portal-publication'
import type { PortalAccessArtifactChannel } from './portal-access-artifact'
import type { PortalHealthReason, PortalHealthStatus } from './portal-health'

type PortalEventArgs<T> = Omit<T, '_tag' | 'eventId' | 'correlationId'> &
  Readonly<{ correlationId?: string | null }>

// ── Portal events ──────────────────────────────────────────────────

export type PortalCreated = Readonly<{
  _tag: 'portal.created'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  publicationState: PortalPublicationState
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalUpdated = Readonly<{
  _tag: 'portal.updated'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  previousPublicationState: PortalPublicationState
  publicationState: PortalPublicationState
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

/**
 * Exact immutable publication evidence for a deliberate publish/republish.
 * The digest is safe verification metadata; resolved Portal content and the
 * provider destination remain in the owning snapshot tables.
 */
export type PortalPublicationPublished = Readonly<{
  _tag: 'portal.publication.published'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  publicationSnapshotId: string
  publicationVersion: number
  publicationDigest: string
  userId: UserId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

/** Exact target snapshot evidence for an append-only publication rollback. */
export type PortalPublicationRolledBack = Readonly<{
  _tag: 'portal.publication.rolled_back'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  publicationSnapshotId: string
  publicationVersion: number
  publicationDigest: string
  userId: UserId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

/** Content-free proof of a recoverable transition into Archived. */
export type PortalArchived = Readonly<{
  _tag: 'portal.archived'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  userId: UserId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

/** Content-free proof that Archived returned to Disabled, never Published. */
export type PortalRestored = Readonly<{
  _tag: 'portal.restored'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  userId: UserId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalDeleted = Readonly<{
  _tag: 'portal.deleted'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

/**
 * Recovery fact raised on the transition from one-or-more eligible responsible
 * managers to none, and when a newly-created portal has no eligible default.
 * Identifier-only by design: consumers resolve any display data through an
 * authorized read, and the recovery notification intentionally needs none.
 */
export type PortalResponsibilityNeeded = Readonly<{
  _tag: 'portal.responsibility_became_needed'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

/** Identifier-only fact for a committed responsible-manager selection change. */
export type PortalResponsibleManagersUpdated = Readonly<{
  _tag: 'portal.responsible_managers.updated'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  assignmentCount: number
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

/**
 * Identifier-only fact for an automatically reconciled Health interval change.
 * It carries the prior and committed enum pairs so downstream notifications can
 * distinguish recovery from degradation without loading guest-facing content.
 */
export type PortalHealthChanged = Readonly<{
  _tag: 'portal.health.changed'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  previousStatus: PortalHealthStatus
  previousReason: PortalHealthReason
  status: PortalHealthStatus
  reason: PortalHealthReason
  sourceVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalPropertyBrandProfileUpdated = Readonly<{
  _tag: 'portal.property_brand_profile.updated'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  profileVersion: number
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalPropertyBrandContentUpdated = Readonly<{
  _tag: 'portal.property_brand_content.updated'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  guestLocale: 'en' | 'bg'
  contentVersion: number
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalLocalizedOverrideUpdated = Readonly<{
  _tag: 'portal.localized_override.updated'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  guestLocale: 'en' | 'bg'
  overrideVersion: number | null
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalLocaleSetUpdated = Readonly<{
  _tag: 'portal.locale_set.updated'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  primaryGuestLocale: 'en' | 'bg'
  additionalGuestLocales: readonly ('en' | 'bg')[]
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalApprovedDestinationUpdated = Readonly<{
  _tag: 'portal.approved_destination.updated'
  eventId: string
  approvedDestinationId: PortalApprovedDestinationId
  organizationId: OrganizationId
  propertyId: PropertyId
  approvalState: 'pending' | 'approved' | 'disabled' | 'quarantined'
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

/**
 * Durable, content-free hand-off from upload finalization to image processing.
 * `sourceETag` is an object-version fence, not guest content; the consumer
 * binds it to S3 `If-Match` before decoding any bytes.
 */
export type PortalHeroImageProcessingRequested = Readonly<{
  _tag: 'portal.hero_image.processing_requested'
  eventId: string
  uploadId: string
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceETag: string
  occurredAt: Date
  correlationId: string | null
}>

/** Durable completion fact; deliberately excludes the published URL. */
export type PortalHeroImagePublished = Readonly<{
  _tag: 'portal.hero_image.published'
  eventId: string
  uploadId: string
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalTokenIssued = Readonly<{
  _tag: 'portal.token.issued'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  tokenIdentifier: string
  version: number
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalTokenRotated = Readonly<{
  _tag: 'portal.token.rotated'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  previousVersion: number
  version: number
  gracePeriodEnds: Date
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalTokenRevoked = Readonly<{
  _tag: 'portal.token.revoked'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

/** Identifier-only proof that a controlled channel marker was published. */
export type PortalAccessArtifactPublished = Readonly<{
  _tag: 'portal.access_artifact.published'
  eventId: string
  accessArtifactId: PortalAccessArtifactId
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  channel: PortalAccessArtifactChannel
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

type PortalWorkflowFactFields = Readonly<{
  reviewId: string
  revision: number
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  portalGroupId: PortalGroupId | null
  supersedesSourceEventId: string | null
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId?: string | null
}>

export type PortalContentReviewCompleted = Readonly<{
  _tag: 'portal.content_review.completed'
  eventId: string
  reviewId: string
  revision: number
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  portalGroupId: PortalGroupId | null
  supersedesSourceEventId: string | null
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalConfigurationCompletenessRecorded = Readonly<{
  _tag: 'portal.configuration_completeness.recorded'
  eventId: string
  reviewId: string
  revision: number
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  portalGroupId: PortalGroupId | null
  supersedesSourceEventId: string | null
  sourceAggregateVersion: string
  completedFields: number
  requiredFields: number
  occurredAt: Date
  correlationId: string | null
}>

export type PortalApprovedDestinationRatioRecorded = Readonly<{
  _tag: 'portal.approved_destination_ratio.recorded'
  eventId: string
  reviewId: string
  revision: number
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  portalGroupId: PortalGroupId | null
  supersedesSourceEventId: string | null
  sourceAggregateVersion: string
  approvedDestinations: number
  configuredDestinations: number
  occurredAt: Date
  correlationId: string | null
}>

// ── Link category events ───────────────────────────────────────────

export type PortalLinkCategoryCreated = Readonly<{
  _tag: 'portal_link_category.created'
  eventId: string
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalLinkCategoryReordered = Readonly<{
  _tag: 'portal_link_category.reordered'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalLinkCategoryUpdated = Readonly<{
  _tag: 'portal_link_category.updated'
  eventId: string
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalLinkCategoryDeleted = Readonly<{
  _tag: 'portal_link_category.deleted'
  eventId: string
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

// ── Link events ────────────────────────────────────────────────────

export type PortalLinkCreated = Readonly<{
  _tag: 'portal_link.created'
  eventId: string
  portalId: PortalId
  linkId: PortalLinkId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalLinkReordered = Readonly<{
  _tag: 'portal_link.reordered'
  eventId: string
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalLinkUpdated = Readonly<{
  _tag: 'portal_link.updated'
  eventId: string
  portalId: PortalId
  linkId: PortalLinkId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalLinkDeleted = Readonly<{
  _tag: 'portal_link.deleted'
  eventId: string
  portalId: PortalId
  linkId: PortalLinkId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

// ── Portal group events ───────────────────────────────────────────

export type PortalGroupCreated = Readonly<{
  _tag: 'portal_group.created'
  eventId: string
  portalGroupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalGroupUpdated = Readonly<{
  _tag: 'portal_group.updated'
  eventId: string
  portalGroupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalGroupDeleted = Readonly<{
  _tag: 'portal_group.deleted'
  eventId: string
  portalGroupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalAddedToGroup = Readonly<{
  _tag: 'portal_group.portal_added'
  eventId: string
  portalGroupId: PortalGroupId
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalRemovedFromGroup = Readonly<{
  _tag: 'portal_group.portal_removed'
  eventId: string
  portalGroupId: PortalGroupId
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

// ── Event union ────────────────────────────────────────────────────

export type PortalEvent =
  | PortalCreated
  | PortalUpdated
  | PortalPublicationPublished
  | PortalPublicationRolledBack
  | PortalArchived
  | PortalRestored
  | PortalDeleted
  | PortalResponsibilityNeeded
  | PortalResponsibleManagersUpdated
  | PortalHealthChanged
  | PortalPropertyBrandProfileUpdated
  | PortalPropertyBrandContentUpdated
  | PortalLocalizedOverrideUpdated
  | PortalLocaleSetUpdated
  | PortalApprovedDestinationUpdated
  | PortalHeroImageProcessingRequested
  | PortalHeroImagePublished
  | PortalTokenIssued
  | PortalTokenRotated
  | PortalTokenRevoked
  | PortalAccessArtifactPublished
  | PortalContentReviewCompleted
  | PortalConfigurationCompletenessRecorded
  | PortalApprovedDestinationRatioRecorded
  | PortalLinkCategoryCreated
  | PortalLinkCategoryReordered
  | PortalLinkCategoryUpdated
  | PortalLinkCategoryDeleted
  | PortalLinkCreated
  | PortalLinkReordered
  | PortalLinkUpdated
  | PortalLinkDeleted
  | PortalGroupCreated
  | PortalGroupUpdated
  | PortalGroupDeleted
  | PortalAddedToGroup
  | PortalRemovedFromGroup

// ── Event constructors ─────────────────────────────────────────────

function assertPortalLifecycleFact(args: {
  occurredAt: Date
  sourceAggregateVersion: string
}): void {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(
    !Number.isNaN(Date.parse(args.sourceAggregateVersion)) &&
      new Date(args.sourceAggregateVersion).toISOString() === args.sourceAggregateVersion,
    'sourceAggregateVersion must be an ISO timestamp',
  )
}

export const portalCreated = (args: PortalEventArgs<PortalCreated>): PortalCreated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal.created',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalUpdated = (args: PortalEventArgs<PortalUpdated>): PortalUpdated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal.updated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

type PortalPublicationFactArgs<
  T extends PortalPublicationPublished | PortalPublicationRolledBack,
> = PortalEventArgs<T>

function portalPublicationFactPayload(
  args: PortalPublicationFactArgs<
    PortalPublicationPublished | PortalPublicationRolledBack
  >,
): Omit<PortalPublicationPublished, '_tag' | 'eventId' | 'occurredAt' | 'correlationId'> {
  return {
    organizationId: args.organizationId,
    propertyId: args.propertyId,
    portalId: args.portalId,
    publicationSnapshotId: args.publicationSnapshotId,
    publicationVersion: args.publicationVersion,
    publicationDigest: args.publicationDigest,
    userId: args.userId,
    sourceAggregateVersion: args.sourceAggregateVersion,
  }
}

function assertPortalPublicationFact(
  args: PortalPublicationFactArgs<
    PortalPublicationPublished | PortalPublicationRolledBack
  >,
): void {
  assertPortalLifecycleFact(args)
  assert(
    args.publicationSnapshotId.trim().length > 0,
    'publicationSnapshotId must be non-empty',
  )
  assert(
    Number.isSafeInteger(args.publicationVersion) && args.publicationVersion > 0,
    'publicationVersion must be a positive integer',
  )
  assert(
    /^[0-9a-f]{64}$/u.test(args.publicationDigest),
    'publicationDigest must be a SHA-256 hex digest',
  )
  assert(String(args.userId).trim().length > 0, 'userId must be non-empty')
}

export const portalPublicationPublished = (
  args: PortalPublicationFactArgs<PortalPublicationPublished>,
): PortalPublicationPublished => {
  assertPortalPublicationFact(args)
  return {
    _tag: 'portal.publication.published',
    eventId: newEventId(),
    ...portalPublicationFactPayload(args),
    occurredAt: args.occurredAt,
    correlationId: args.correlationId ?? null,
  }
}

export const portalPublicationRolledBack = (
  args: PortalPublicationFactArgs<PortalPublicationRolledBack>,
): PortalPublicationRolledBack => {
  assertPortalPublicationFact(args)
  return {
    _tag: 'portal.publication.rolled_back',
    eventId: newEventId(),
    ...portalPublicationFactPayload(args),
    occurredAt: args.occurredAt,
    correlationId: args.correlationId ?? null,
  }
}

type PortalArchiveFactArgs<T extends PortalArchived | PortalRestored> = PortalEventArgs<T>

function portalArchiveFactPayload(
  args: PortalArchiveFactArgs<PortalArchived | PortalRestored>,
): Omit<PortalArchived, '_tag' | 'eventId' | 'occurredAt' | 'correlationId'> {
  return {
    organizationId: args.organizationId,
    propertyId: args.propertyId,
    portalId: args.portalId,
    userId: args.userId,
    sourceAggregateVersion: args.sourceAggregateVersion,
  }
}

function assertPortalArchiveFact(
  args: PortalArchiveFactArgs<PortalArchived | PortalRestored>,
): void {
  assertPortalLifecycleFact(args)
  assert(String(args.userId).trim().length > 0, 'userId must be non-empty')
}

export const portalArchived = (
  args: PortalArchiveFactArgs<PortalArchived>,
): PortalArchived => {
  assertPortalArchiveFact(args)
  return {
    _tag: 'portal.archived',
    eventId: newEventId(),
    ...portalArchiveFactPayload(args),
    occurredAt: args.occurredAt,
    correlationId: args.correlationId ?? null,
  }
}

export const portalRestored = (
  args: PortalArchiveFactArgs<PortalRestored>,
): PortalRestored => {
  assertPortalArchiveFact(args)
  return {
    _tag: 'portal.restored',
    eventId: newEventId(),
    ...portalArchiveFactPayload(args),
    occurredAt: args.occurredAt,
    correlationId: args.correlationId ?? null,
  }
}

export const portalDeleted = (args: PortalEventArgs<PortalDeleted>): PortalDeleted => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal.deleted',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalResponsibilityNeeded = (
  args: PortalEventArgs<PortalResponsibilityNeeded>,
): PortalResponsibilityNeeded => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal.responsibility_became_needed',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalResponsibleManagersUpdated = (
  args: PortalEventArgs<PortalResponsibleManagersUpdated>,
): PortalResponsibleManagersUpdated => {
  assertPortalLifecycleFact(args)
  assert(
    Number.isInteger(args.assignmentCount) && args.assignmentCount >= 0,
    'assignmentCount must be a non-negative integer',
  )
  return {
    _tag: 'portal.responsible_managers.updated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalHealthChanged = (
  args: PortalEventArgs<PortalHealthChanged>,
): PortalHealthChanged => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(
    args.sourceVersion.trim().length > 0 && args.sourceVersion.length <= 160,
    'sourceVersion must be a non-empty health fence',
  )
  assert(
    args.previousStatus !== args.status || args.previousReason !== args.reason,
    'Portal Health change must change the persisted status or reason',
  )
  return {
    _tag: 'portal.health.changed',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalPropertyBrandProfileUpdated = (
  args: PortalEventArgs<PortalPropertyBrandProfileUpdated>,
): PortalPropertyBrandProfileUpdated => {
  assertPortalLifecycleFact(args)
  assert(
    Number.isInteger(args.profileVersion) && args.profileVersion > 0,
    'Portal brand profile version must be a positive integer',
  )
  return {
    _tag: 'portal.property_brand_profile.updated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalPropertyBrandContentUpdated = (
  args: PortalEventArgs<PortalPropertyBrandContentUpdated>,
): PortalPropertyBrandContentUpdated => {
  assertPortalLifecycleFact(args)
  assert(
    args.guestLocale === 'en' || args.guestLocale === 'bg',
    'Portal brand content locale must be supported',
  )
  assert(
    Number.isInteger(args.contentVersion) && args.contentVersion > 0,
    'Portal brand content version must be a positive integer',
  )
  return {
    _tag: 'portal.property_brand_content.updated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLocalizedOverrideUpdated = (
  args: PortalEventArgs<PortalLocalizedOverrideUpdated>,
): PortalLocalizedOverrideUpdated => {
  assertPortalLifecycleFact(args)
  assert(
    args.guestLocale === 'en' || args.guestLocale === 'bg',
    'Portal localized override locale must be supported',
  )
  assert(
    args.overrideVersion === null ||
      (Number.isInteger(args.overrideVersion) && args.overrideVersion > 0),
    'Portal localized override version must be null or a positive integer',
  )
  return {
    _tag: 'portal.localized_override.updated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLocaleSetUpdated = (
  args: PortalEventArgs<PortalLocaleSetUpdated>,
): PortalLocaleSetUpdated => {
  assertPortalLifecycleFact(args)
  assert(
    args.primaryGuestLocale === 'en' || args.primaryGuestLocale === 'bg',
    'Portal primary guest locale must be supported',
  )
  assert(
    args.additionalGuestLocales.every((locale) => locale === 'en' || locale === 'bg'),
    'Portal additional guest locales must be supported',
  )
  assert(
    !args.additionalGuestLocales.includes(args.primaryGuestLocale),
    'Portal primary guest locale cannot also be additional',
  )
  return {
    _tag: 'portal.locale_set.updated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalApprovedDestinationUpdated = (
  args: PortalEventArgs<PortalApprovedDestinationUpdated>,
): PortalApprovedDestinationUpdated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal.approved_destination.updated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalHeroImagePublished = (
  args: PortalEventArgs<PortalHeroImagePublished>,
): PortalHeroImagePublished => {
  assertPortalLifecycleFact(args)
  assert(args.uploadId.trim().length > 0, 'uploadId must be non-empty')
  return {
    _tag: 'portal.hero_image.published',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalHeroImageProcessingRequested = (
  args: PortalEventArgs<PortalHeroImageProcessingRequested>,
): PortalHeroImageProcessingRequested => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.uploadId.trim().length > 0, 'uploadId must be non-empty')
  assert(
    /^[A-Za-z0-9"'-]{1,200}$/.test(args.sourceETag),
    'sourceETag must be a safe non-empty object version fence',
  )
  return {
    _tag: 'portal.hero_image.processing_requested',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalTokenIssued = (
  args: PortalEventArgs<PortalTokenIssued>,
): PortalTokenIssued => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal.token.issued',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalTokenRotated = (
  args: PortalEventArgs<PortalTokenRotated>,
): PortalTokenRotated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal.token.rotated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalTokenRevoked = (
  args: PortalEventArgs<PortalTokenRevoked>,
): PortalTokenRevoked => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal.token.revoked',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalAccessArtifactPublished = (
  args: PortalEventArgs<PortalAccessArtifactPublished>,
): PortalAccessArtifactPublished => {
  assertPortalLifecycleFact(args)
  assert(args.accessArtifactId !== '', 'accessArtifactId required')
  assert(args.channel === 'qr' || args.channel === 'nfc', 'controlled channel required')
  return {
    _tag: 'portal.access_artifact.published',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkCategoryCreated = (
  args: PortalEventArgs<PortalLinkCategoryCreated>,
): PortalLinkCategoryCreated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link_category.created',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkCategoryReordered = (
  args: PortalEventArgs<PortalLinkCategoryReordered>,
): PortalLinkCategoryReordered => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link_category.reordered',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkCategoryUpdated = (
  args: PortalEventArgs<PortalLinkCategoryUpdated>,
): PortalLinkCategoryUpdated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link_category.updated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkCategoryDeleted = (
  args: PortalEventArgs<PortalLinkCategoryDeleted>,
): PortalLinkCategoryDeleted => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link_category.deleted',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkCreated = (
  args: PortalEventArgs<PortalLinkCreated>,
): PortalLinkCreated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link.created',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkReordered = (
  args: PortalEventArgs<PortalLinkReordered>,
): PortalLinkReordered => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link.reordered',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkUpdated = (
  args: PortalEventArgs<PortalLinkUpdated>,
): PortalLinkUpdated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link.updated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkDeleted = (
  args: PortalEventArgs<PortalLinkDeleted>,
): PortalLinkDeleted => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link.deleted',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

// ── Portal group event constructors ────────────────────────────────

export const portalGroupCreated = (
  args: PortalEventArgs<PortalGroupCreated>,
): PortalGroupCreated => {
  assertPortalLifecycleFact(args)
  if (!args.name || args.name.trim().length === 0) {
    throw portalError('invalid_name', 'name must be a non-empty string')
  }
  return {
    _tag: 'portal_group.created',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalGroupUpdated = (
  args: PortalEventArgs<PortalGroupUpdated>,
): PortalGroupUpdated => {
  assertPortalLifecycleFact(args)
  if (!args.name || args.name.trim().length === 0) {
    throw portalError('invalid_name', 'name must be a non-empty string')
  }
  return {
    _tag: 'portal_group.updated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalGroupDeleted = (
  args: PortalEventArgs<PortalGroupDeleted>,
): PortalGroupDeleted => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_group.deleted',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalAddedToGroup = (
  args: PortalEventArgs<PortalAddedToGroup>,
): PortalAddedToGroup => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_group.portal_added',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalRemovedFromGroup = (
  args: PortalEventArgs<PortalRemovedFromGroup>,
): PortalRemovedFromGroup => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_group.portal_removed',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

type PortalWorkflowFact =
  | PortalContentReviewCompleted
  | PortalConfigurationCompletenessRecorded
  | PortalApprovedDestinationRatioRecorded

type PortalWorkflowFactArgs<T extends PortalWorkflowFact> = PortalEventArgs<T>

function assertPortalWorkflowFact(args: PortalWorkflowFactFields): void {
  assertPortalLifecycleFact(args)
  assert(args.reviewId.trim().length > 0, 'reviewId must be non-empty')
  assert(
    Number.isInteger(args.revision) && args.revision >= 1,
    'revision must be a positive integer',
  )
}

export const portalContentReviewCompleted = (
  args: PortalWorkflowFactArgs<PortalContentReviewCompleted>,
): PortalContentReviewCompleted => {
  assertPortalWorkflowFact(args)
  return {
    _tag: 'portal.content_review.completed',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalConfigurationCompletenessRecorded = (
  args: PortalWorkflowFactArgs<PortalConfigurationCompletenessRecorded>,
): PortalConfigurationCompletenessRecorded => {
  assertPortalWorkflowFact(args)
  assert(
    Number.isInteger(args.requiredFields) && args.requiredFields > 0,
    'requiredFields must be a positive integer',
  )
  assert(
    Number.isInteger(args.completedFields) &&
      args.completedFields >= 0 &&
      args.completedFields <= args.requiredFields,
    'completedFields must be between zero and requiredFields',
  )
  return {
    _tag: 'portal.configuration_completeness.recorded',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalApprovedDestinationRatioRecorded = (
  args: PortalWorkflowFactArgs<PortalApprovedDestinationRatioRecorded>,
): PortalApprovedDestinationRatioRecorded => {
  assertPortalWorkflowFact(args)
  assert(
    Number.isInteger(args.configuredDestinations) && args.configuredDestinations >= 0,
    'configuredDestinations must be a non-negative integer',
  )
  assert(
    Number.isInteger(args.approvedDestinations) &&
      args.approvedDestinations >= 0 &&
      args.approvedDestinations <= args.configuredDestinations,
    'approvedDestinations must be between zero and configuredDestinations',
  )
  return {
    _tag: 'portal.approved_destination_ratio.recorded',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}
