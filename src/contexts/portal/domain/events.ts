import { assert } from '#/shared/domain/assert'
import {
  isGuestLocale,
  isValidAdditionalGuestLocales,
  type GuestLocale,
} from '#/shared/domain/guest-locale'
import type { PortalId } from './types'
import type {
  OrganizationId,
  PortalGroupId,
  PortalAccessArtifactId,
  PortalApprovedDestinationId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import type { PortalPublicationState } from './portal-publication'
import type { PortalAccessArtifactChannel } from './portal-access-artifact'
import type { PortalHealthReason, PortalHealthStatus } from './portal-health'
import {
  assertPortalLifecycleFact,
  createPortalEvent,
  type PortalEventArgs,
  type PortalLifecycleFact,
  type PortalFact,
} from './portal-event-base'
import type {
  PortalAddedToGroup,
  PortalGroupCreated,
  PortalGroupDeleted,
  PortalGroupUpdated,
  PortalRemovedFromGroup,
} from './portal-group-events'
import type {
  PortalLinkCategoryCreated,
  PortalLinkCategoryDeleted,
  PortalLinkCategoryReordered,
  PortalLinkCategoryUpdated,
  PortalLinkCreated,
  PortalLinkDeleted,
  PortalLinkReordered,
  PortalLinkUpdated,
} from './portal-link-events'

export type {
  PortalAddedToGroup,
  PortalGroupCreated,
  PortalGroupDeleted,
  PortalGroupUpdated,
  PortalRemovedFromGroup,
} from './portal-group-events'
export {
  portalAddedToGroup,
  portalGroupCreated,
  portalGroupDeleted,
  portalGroupUpdated,
  portalRemovedFromGroup,
} from './portal-group-events'
export type {
  PortalLinkCategoryCreated,
  PortalLinkCategoryDeleted,
  PortalLinkCategoryReordered,
  PortalLinkCategoryUpdated,
  PortalLinkCreated,
  PortalLinkDeleted,
  PortalLinkReordered,
  PortalLinkUpdated,
} from './portal-link-events'
export {
  portalLinkCategoryCreated,
  portalLinkCategoryDeleted,
  portalLinkCategoryReordered,
  portalLinkCategoryUpdated,
  portalLinkCreated,
  portalLinkDeleted,
  portalLinkReordered,
  portalLinkUpdated,
} from './portal-link-events'

// ── Portal events ──────────────────────────────────────────────────

export type PortalCreated = PortalLifecycleFact<
  'portal.created',
  {
    portalId: PortalId
    publicationState: PortalPublicationState
  }
>

export type PortalUpdated = PortalLifecycleFact<
  'portal.updated',
  {
    portalId: PortalId
    previousPublicationState: PortalPublicationState
    publicationState: PortalPublicationState
  }
>

/**
 * Exact immutable publication evidence for a deliberate publish/republish.
 * The digest is safe verification metadata; resolved Portal content and the
 * provider destination remain in the owning snapshot tables.
 */
export type PortalPublicationPublished = PortalLifecycleFact<
  'portal.publication.published',
  {
    portalId: PortalId
    publicationSnapshotId: string
    publicationVersion: number
    publicationDigest: string
    userId: UserId
  }
>

/** Exact target snapshot evidence for an append-only publication rollback. */
export type PortalPublicationRolledBack = PortalLifecycleFact<
  'portal.publication.rolled_back',
  {
    portalId: PortalId
    publicationSnapshotId: string
    publicationVersion: number
    publicationDigest: string
    userId: UserId
  }
>

/** Content-free proof of a recoverable transition into Archived. */
export type PortalArchived = PortalLifecycleFact<
  'portal.archived',
  {
    portalId: PortalId
    userId: UserId
  }
>

/** Content-free proof that Archived returned to Disabled, never Published. */
export type PortalRestored = PortalLifecycleFact<
  'portal.restored',
  {
    portalId: PortalId
    userId: UserId
  }
>

export type PortalDeleted = PortalLifecycleFact<
  'portal.deleted',
  {
    portalId: PortalId
  }
>

/**
 * Recovery fact raised on the transition from one-or-more eligible responsible
 * managers to none, and when a newly-created portal has no eligible default.
 * Identifier-only by design: consumers resolve any display data through an
 * authorized read, and the recovery notification intentionally needs none.
 */
export type PortalResponsibilityNeeded = PortalLifecycleFact<
  'portal.responsibility_became_needed',
  {
    portalId: PortalId
    /**
     * Whose action left the Portal unstaffed, when a person's did. Nobody is
     * asked to fix work they have just caused, and a system release names no one.
     */
    actorUserId?: UserId | null
  }
>

/** Identifier-only fact for a committed responsible-manager selection change. */
export type PortalResponsibleManagersUpdated = PortalLifecycleFact<
  'portal.responsible_managers.updated',
  {
    portalId: PortalId
    assignmentCount: number
  }
>

/**
 * Identifier-only fact for an automatically reconciled Health interval change.
 * It carries the prior and committed enum pairs so downstream notifications can
 * distinguish recovery from degradation without loading guest-facing content.
 */
export type PortalHealthChanged = PortalFact<
  'portal.health.changed',
  {
    portalId: PortalId
    previousStatus: PortalHealthStatus
    previousReason: PortalHealthReason
    status: PortalHealthStatus
    reason: PortalHealthReason
    sourceVersion: string
  }
>

export type PortalPropertyBrandProfileUpdated = PortalLifecycleFact<
  'portal.property_brand_profile.updated',
  {
    profileVersion: number
  }
>

export type PortalPropertyBrandContentUpdated = PortalLifecycleFact<
  'portal.property_brand_content.updated',
  {
    guestLocale: GuestLocale
    contentVersion: number
  }
>

export type PortalLocalizedOverrideUpdated = PortalLifecycleFact<
  'portal.localized_override.updated',
  {
    portalId: PortalId
    guestLocale: GuestLocale
    overrideVersion: number | null
  }
>

export type PortalLocaleSetUpdated = PortalLifecycleFact<
  'portal.locale_set.updated',
  {
    portalId: PortalId
    primaryGuestLocale: GuestLocale
    additionalGuestLocales: readonly GuestLocale[]
  }
>

export type PortalApprovedDestinationUpdated = PortalLifecycleFact<
  'portal.approved_destination.updated',
  {
    approvedDestinationId: PortalApprovedDestinationId
    approvalState: 'pending' | 'approved' | 'disabled' | 'quarantined'
  }
>

export type PortalTokenIssued = PortalLifecycleFact<
  'portal.token.issued',
  {
    portalId: PortalId
    tokenIdentifier: string
    version: number
  }
>

export type PortalTokenRotated = PortalLifecycleFact<
  'portal.token.rotated',
  {
    portalId: PortalId
    previousVersion: number
    version: number
    gracePeriodEnds: Date
  }
>

export type PortalTokenRevoked = PortalLifecycleFact<
  'portal.token.revoked',
  {
    portalId: PortalId
  }
>

/** Identifier-only proof that a controlled channel marker was published. */
export type PortalAccessArtifactPublished = PortalLifecycleFact<
  'portal.access_artifact.published',
  {
    accessArtifactId: PortalAccessArtifactId
    portalId: PortalId
    channel: PortalAccessArtifactChannel
  }
>

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

export type PortalContentReviewCompleted = PortalLifecycleFact<
  'portal.content_review.completed',
  {
    reviewId: string
    revision: number
    portalId: PortalId
    portalGroupId: PortalGroupId | null
    supersedesSourceEventId: string | null
  }
>

export type PortalConfigurationCompletenessRecorded = PortalLifecycleFact<
  'portal.configuration_completeness.recorded',
  {
    reviewId: string
    revision: number
    portalId: PortalId
    portalGroupId: PortalGroupId | null
    supersedesSourceEventId: string | null
    completedFields: number
    requiredFields: number
    /** Which fields were counted; facts from before the Immersive Hub count say `legacy`. */
    fieldSet: 'legacy' | 'immersive_hub'
  }
>

export type PortalApprovedDestinationRatioRecorded = PortalLifecycleFact<
  'portal.approved_destination_ratio.recorded',
  {
    reviewId: string
    revision: number
    portalId: PortalId
    portalGroupId: PortalGroupId | null
    supersedesSourceEventId: string | null
    approvedDestinations: number
    configuredDestinations: number
  }
>

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

export const portalCreated = (args: PortalEventArgs<PortalCreated>): PortalCreated => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal.created',
    ...args,
  })
}

export const portalUpdated = (args: PortalEventArgs<PortalUpdated>): PortalUpdated => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal.updated',
    ...args,
  })
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
  return createPortalEvent({
    _tag: 'portal.publication.published',
    ...portalPublicationFactPayload(args),
    occurredAt: args.occurredAt,
    correlationId: args.correlationId,
  })
}

export const portalPublicationRolledBack = (
  args: PortalPublicationFactArgs<PortalPublicationRolledBack>,
): PortalPublicationRolledBack => {
  assertPortalPublicationFact(args)
  return createPortalEvent({
    _tag: 'portal.publication.rolled_back',
    ...portalPublicationFactPayload(args),
    occurredAt: args.occurredAt,
    correlationId: args.correlationId,
  })
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
  return createPortalEvent({
    _tag: 'portal.archived',
    ...portalArchiveFactPayload(args),
    occurredAt: args.occurredAt,
    correlationId: args.correlationId,
  })
}

export const portalRestored = (
  args: PortalArchiveFactArgs<PortalRestored>,
): PortalRestored => {
  assertPortalArchiveFact(args)
  return createPortalEvent({
    _tag: 'portal.restored',
    ...portalArchiveFactPayload(args),
    occurredAt: args.occurredAt,
    correlationId: args.correlationId,
  })
}

export const portalDeleted = (args: PortalEventArgs<PortalDeleted>): PortalDeleted => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal.deleted',
    ...args,
  })
}

export const portalResponsibilityNeeded = (
  args: PortalEventArgs<PortalResponsibilityNeeded>,
): PortalResponsibilityNeeded => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal.responsibility_became_needed',
    ...args,
  })
}

export const portalResponsibleManagersUpdated = (
  args: PortalEventArgs<PortalResponsibleManagersUpdated>,
): PortalResponsibleManagersUpdated => {
  assertPortalLifecycleFact(args)
  assert(
    Number.isInteger(args.assignmentCount) && args.assignmentCount >= 0,
    'assignmentCount must be a non-negative integer',
  )
  return createPortalEvent({
    _tag: 'portal.responsible_managers.updated',
    ...args,
  })
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
  return createPortalEvent({
    _tag: 'portal.health.changed',
    ...args,
  })
}

export const portalPropertyBrandProfileUpdated = (
  args: PortalEventArgs<PortalPropertyBrandProfileUpdated>,
): PortalPropertyBrandProfileUpdated => {
  assertPortalLifecycleFact(args)
  assert(
    Number.isInteger(args.profileVersion) && args.profileVersion > 0,
    'Portal brand profile version must be a positive integer',
  )
  return createPortalEvent({
    _tag: 'portal.property_brand_profile.updated',
    ...args,
  })
}

export const portalPropertyBrandContentUpdated = (
  args: PortalEventArgs<PortalPropertyBrandContentUpdated>,
): PortalPropertyBrandContentUpdated => {
  assertPortalLifecycleFact(args)
  assert(isGuestLocale(args.guestLocale), 'Portal brand content locale must be supported')
  assert(
    Number.isInteger(args.contentVersion) && args.contentVersion > 0,
    'Portal brand content version must be a positive integer',
  )
  return createPortalEvent({
    _tag: 'portal.property_brand_content.updated',
    ...args,
  })
}

export const portalLocalizedOverrideUpdated = (
  args: PortalEventArgs<PortalLocalizedOverrideUpdated>,
): PortalLocalizedOverrideUpdated => {
  assertPortalLifecycleFact(args)
  assert(
    isGuestLocale(args.guestLocale),
    'Portal localized override locale must be supported',
  )
  assert(
    args.overrideVersion === null ||
      (Number.isInteger(args.overrideVersion) && args.overrideVersion > 0),
    'Portal localized override version must be null or a positive integer',
  )
  return createPortalEvent({
    _tag: 'portal.localized_override.updated',
    ...args,
  })
}

export const portalLocaleSetUpdated = (
  args: PortalEventArgs<PortalLocaleSetUpdated>,
): PortalLocaleSetUpdated => {
  assertPortalLifecycleFact(args)
  assert(
    isGuestLocale(args.primaryGuestLocale),
    'Portal primary guest locale must be supported',
  )
  assert(
    isValidAdditionalGuestLocales(args.primaryGuestLocale, args.additionalGuestLocales),
    'Portal additional guest locales must be supported, unique, and not repeat the primary',
  )
  return createPortalEvent({
    _tag: 'portal.locale_set.updated',
    ...args,
  })
}

export const portalApprovedDestinationUpdated = (
  args: PortalEventArgs<PortalApprovedDestinationUpdated>,
): PortalApprovedDestinationUpdated => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal.approved_destination.updated',
    ...args,
  })
}

export const portalTokenIssued = (
  args: PortalEventArgs<PortalTokenIssued>,
): PortalTokenIssued => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal.token.issued',
    ...args,
  })
}

export const portalTokenRotated = (
  args: PortalEventArgs<PortalTokenRotated>,
): PortalTokenRotated => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal.token.rotated',
    ...args,
  })
}

export const portalTokenRevoked = (
  args: PortalEventArgs<PortalTokenRevoked>,
): PortalTokenRevoked => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal.token.revoked',
    ...args,
  })
}

export const portalAccessArtifactPublished = (
  args: PortalEventArgs<PortalAccessArtifactPublished>,
): PortalAccessArtifactPublished => {
  assertPortalLifecycleFact(args)
  assert(args.accessArtifactId !== '', 'accessArtifactId required')
  assert(args.channel === 'qr' || args.channel === 'nfc', 'controlled channel required')
  return createPortalEvent({
    _tag: 'portal.access_artifact.published',
    ...args,
  })
}

function assertPortalWorkflowFact(args: PortalWorkflowFactFields): void {
  assertPortalLifecycleFact(args)
  assert(args.reviewId.trim().length > 0, 'reviewId must be non-empty')
  assert(
    Number.isInteger(args.revision) && args.revision >= 1,
    'revision must be a positive integer',
  )
}

export const portalContentReviewCompleted = (
  args: PortalEventArgs<PortalContentReviewCompleted>,
): PortalContentReviewCompleted => {
  assertPortalWorkflowFact(args)
  return createPortalEvent({
    _tag: 'portal.content_review.completed',
    ...args,
  })
}
