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
  PropertyId,
} from '#/shared/domain/ids'
import { portalError } from './errors'
import type { PortalPublicationState } from './portal-publication'

// ── Portal events ──────────────────────────────────────────────────

export type PortalCreated = Readonly<{
  _tag: 'portal.created'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  publicationState: PortalPublicationState
  sourceAggregateVersion: string
  occurredAt: Date
}>

export type PortalUpdated = Readonly<{
  _tag: 'portal.updated'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  previousPublicationState: PortalPublicationState
  publicationState: PortalPublicationState
  sourceAggregateVersion: string
  occurredAt: Date
}>

export type PortalDeleted = Readonly<{
  _tag: 'portal.deleted'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
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
  correlationId: string | null
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  occurredAt: Date
}>

/**
 * Durable, content-free hand-off from upload finalization to image processing.
 * `sourceETag` is an object-version fence, not guest content; the consumer
 * binds it to S3 `If-Match` before decoding any bytes.
 */
export type PortalHeroImageProcessingRequested = Readonly<{
  _tag: 'portal.hero_image.processing_requested'
  eventId: string
  correlationId: string | null
  uploadId: string
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceETag: string
  occurredAt: Date
}>

export type PortalTokenIssued = Readonly<{
  _tag: 'portal.token.issued'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  tokenIdentifier: string
  version: number
  sourceAggregateVersion: string
  occurredAt: Date
}>

export type PortalTokenRotated = Readonly<{
  _tag: 'portal.token.rotated'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  previousVersion: number
  version: number
  gracePeriodEnds: Date
  sourceAggregateVersion: string
  occurredAt: Date
}>

export type PortalTokenRevoked = Readonly<{
  _tag: 'portal.token.revoked'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
}>

type PortalWorkflowFactBase = Readonly<{
  eventId: string
  correlationId: string | null
  reviewId: string
  revision: number
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  portalGroupId: PortalGroupId | null
  supersedesSourceEventId: string | null
  occurredAt: Date
}>

export type PortalContentReviewCompleted = PortalWorkflowFactBase &
  Readonly<{ _tag: 'portal.content_review.completed' }>

export type PortalConfigurationCompletenessRecorded = PortalWorkflowFactBase &
  Readonly<{
    _tag: 'portal.configuration_completeness.recorded'
    completedFields: number
    requiredFields: number
  }>

export type PortalApprovedDestinationRatioRecorded = PortalWorkflowFactBase &
  Readonly<{
    _tag: 'portal.approved_destination_ratio.recorded'
    approvedDestinations: number
    configuredDestinations: number
  }>

// ── Link category events ───────────────────────────────────────────

export type PortalLinkCategoryCreated = Readonly<{
  _tag: 'portal_link_category.created'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
}>

export type PortalLinkCategoryReordered = Readonly<{
  _tag: 'portal_link_category.reordered'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
}>

// ── Link events ────────────────────────────────────────────────────

export type PortalLinkCreated = Readonly<{
  _tag: 'portal_link.created'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  linkId: PortalLinkId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
}>

export type PortalLinkReordered = Readonly<{
  _tag: 'portal_link.reordered'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
}>

// ── Portal group events ───────────────────────────────────────────

export type PortalGroupCreated = Readonly<{
  _tag: 'portal_group.created'
  eventId: string
  correlationId: string | null
  portalGroupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  sourceAggregateVersion: string
  occurredAt: Date
}>

export type PortalGroupUpdated = Readonly<{
  _tag: 'portal_group.updated'
  eventId: string
  correlationId: string | null
  portalGroupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  sourceAggregateVersion: string
  occurredAt: Date
}>

export type PortalGroupDeleted = Readonly<{
  _tag: 'portal_group.deleted'
  eventId: string
  correlationId: string | null
  portalGroupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  occurredAt: Date
}>

export type PortalAddedToGroup = Readonly<{
  _tag: 'portal_group.portal_added'
  eventId: string
  correlationId: string | null
  portalGroupId: PortalGroupId
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
}>

export type PortalRemovedFromGroup = Readonly<{
  _tag: 'portal_group.portal_removed'
  eventId: string
  correlationId: string | null
  portalGroupId: PortalGroupId
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
}>

// ── Event union ────────────────────────────────────────────────────

export type PortalEvent =
  | PortalCreated
  | PortalUpdated
  | PortalDeleted
  | PortalResponsibilityNeeded
  | PortalHeroImageProcessingRequested
  | PortalTokenIssued
  | PortalTokenRotated
  | PortalTokenRevoked
  | PortalContentReviewCompleted
  | PortalConfigurationCompletenessRecorded
  | PortalApprovedDestinationRatioRecorded
  | PortalLinkCategoryCreated
  | PortalLinkCategoryReordered
  | PortalLinkCreated
  | PortalLinkReordered
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
    args.sourceAggregateVersion === args.occurredAt.toISOString(),
    'sourceAggregateVersion must equal occurredAt in ISO format',
  )
}

export const portalCreated = (
  args: Omit<PortalCreated, '_tag' | 'eventId' | 'correlationId'>,
): PortalCreated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal.created',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalUpdated = (
  args: Omit<PortalUpdated, '_tag' | 'eventId' | 'correlationId'>,
): PortalUpdated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal.updated',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalDeleted = (
  args: Omit<PortalDeleted, '_tag' | 'eventId' | 'correlationId'>,
): PortalDeleted => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal.deleted',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalResponsibilityNeeded = (
  args: Omit<PortalResponsibilityNeeded, '_tag' | 'eventId' | 'correlationId'>,
): PortalResponsibilityNeeded => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal.responsibility_became_needed',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalHeroImageProcessingRequested = (
  args: Omit<PortalHeroImageProcessingRequested, '_tag' | 'eventId' | 'correlationId'>,
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
    correlationId: null,
    ...args,
  }
}

export const portalTokenIssued = (
  args: Omit<PortalTokenIssued, '_tag' | 'eventId' | 'correlationId'>,
): PortalTokenIssued => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal.token.issued',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalTokenRotated = (
  args: Omit<PortalTokenRotated, '_tag' | 'eventId' | 'correlationId'>,
): PortalTokenRotated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal.token.rotated',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalTokenRevoked = (
  args: Omit<PortalTokenRevoked, '_tag' | 'eventId' | 'correlationId'>,
): PortalTokenRevoked => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal.token.revoked',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalLinkCategoryCreated = (
  args: Omit<PortalLinkCategoryCreated, '_tag' | 'eventId' | 'correlationId'>,
): PortalLinkCategoryCreated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link_category.created',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalLinkCategoryReordered = (
  args: Omit<PortalLinkCategoryReordered, '_tag' | 'eventId' | 'correlationId'>,
): PortalLinkCategoryReordered => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link_category.reordered',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalLinkCreated = (
  args: Omit<PortalLinkCreated, '_tag' | 'eventId' | 'correlationId'>,
): PortalLinkCreated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link.created',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalLinkReordered = (
  args: Omit<PortalLinkReordered, '_tag' | 'eventId' | 'correlationId'>,
): PortalLinkReordered => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link.reordered',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

// ── Portal group event constructors ────────────────────────────────

export const portalGroupCreated = (
  args: Omit<PortalGroupCreated, '_tag' | 'eventId' | 'correlationId'>,
): PortalGroupCreated => {
  assertPortalLifecycleFact(args)
  if (!args.name || args.name.trim().length === 0) {
    throw portalError('invalid_name', 'name must be a non-empty string')
  }
  return {
    _tag: 'portal_group.created',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalGroupUpdated = (
  args: Omit<PortalGroupUpdated, '_tag' | 'eventId' | 'correlationId'>,
): PortalGroupUpdated => {
  assertPortalLifecycleFact(args)
  if (!args.name || args.name.trim().length === 0) {
    throw portalError('invalid_name', 'name must be a non-empty string')
  }
  return {
    _tag: 'portal_group.updated',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalGroupDeleted = (
  args: Omit<PortalGroupDeleted, '_tag' | 'eventId' | 'correlationId'>,
): PortalGroupDeleted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal_group.deleted',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalAddedToGroup = (
  args: Omit<PortalAddedToGroup, '_tag' | 'eventId' | 'correlationId'>,
): PortalAddedToGroup => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_group.portal_added',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalRemovedFromGroup = (
  args: Omit<PortalRemovedFromGroup, '_tag' | 'eventId' | 'correlationId'>,
): PortalRemovedFromGroup => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_group.portal_removed',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

type PortalWorkflowFactArgs<T extends PortalWorkflowFactBase> = Omit<
  T,
  '_tag' | 'eventId' | 'correlationId'
> &
  Readonly<{ eventId?: string }>

function assertPortalWorkflowFact(
  args: PortalWorkflowFactArgs<PortalWorkflowFactBase>,
): void {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
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
  const { eventId = newEventId(), ...fact } = args
  return {
    _tag: 'portal.content_review.completed',
    eventId,
    correlationId: null,
    ...fact,
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
  const { eventId = newEventId(), ...fact } = args
  return {
    _tag: 'portal.configuration_completeness.recorded',
    eventId,
    correlationId: null,
    ...fact,
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
  const { eventId = newEventId(), ...fact } = args
  return {
    _tag: 'portal.approved_destination_ratio.recorded',
    eventId,
    correlationId: null,
    ...fact,
  }
}
