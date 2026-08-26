import { err, ok, type Result } from '#/shared/domain'
import type {
  InboxItemId,
  OrganizationId,
  PropertyId,
  ReviewId,
  UserId,
} from '#/shared/domain/ids'
import { inboxError, type InboxError } from './errors'
import type { ReviewHandlingCycle, ReviewHandlingCycleHead } from './types'

type ReviewCycleDecision = Readonly<{
  cycle: ReviewHandlingCycle
  head: ReviewHandlingCycleHead
}>

const isPositiveSafeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0

export type CreateInitialReviewHandlingCycleInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  materialReviewRevision: number
  openedAt: Date
  status: ReviewHandlingCycleHead['status']
}>

/** Build cycle one for a newly observed Review without copying provider content. */
export function createInitialReviewHandlingCycle(
  input: CreateInitialReviewHandlingCycleInput,
): Result<ReviewCycleDecision, InboxError> {
  if (!isPositiveSafeInteger(input.materialReviewRevision)) {
    return err(
      inboxError('invalid_input', 'Material Review Revision must be positive', {
        materialReviewRevision: input.materialReviewRevision,
      }),
    )
  }

  const scope = {
    inboxItemId: input.inboxItemId,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    reviewId: input.reviewId,
  }
  return ok({
    cycle: {
      ...scope,
      cycleNumber: 1,
      materialReviewRevision: input.materialReviewRevision,
      openedReason: 'review_observed',
      supersedesCycleNumber: null,
      openedBy: null,
      openedAt: input.openedAt,
    },
    head: {
      ...scope,
      currentCycleNumber: 1,
      currentMaterialReviewRevision: input.materialReviewRevision,
      stateRevision: 1,
      status: input.status,
    },
  })
}

export type CreateNextReviewHandlingCycleInput = Readonly<{
  current: ReviewHandlingCycleHead
  materialReviewRevision: number
  openedReason: 'material_revision_changed' | 'manual_reopen'
  openedBy: UserId | null
  openedAt: Date
}>

/**
 * Decide the next append-only cycle and CAS head. Manual reopen deliberately
 * permits another cycle on the same source revision; a material-change trigger
 * must advance it.
 */
export function createNextReviewHandlingCycle(
  input: CreateNextReviewHandlingCycleInput,
): Result<ReviewCycleDecision, InboxError> {
  const { current } = input
  if (
    !isPositiveSafeInteger(current.currentCycleNumber) ||
    !isPositiveSafeInteger(current.currentMaterialReviewRevision) ||
    !isPositiveSafeInteger(current.stateRevision) ||
    !isPositiveSafeInteger(input.materialReviewRevision)
  ) {
    return err(inboxError('invalid_input', 'Handling Cycle revisions must be positive'))
  }

  if (
    input.openedReason === 'material_revision_changed' &&
    input.materialReviewRevision <= current.currentMaterialReviewRevision
  ) {
    return err(
      inboxError(
        'invalid_input',
        'A material-change cycle must advance the Material Review Revision',
        {
          currentMaterialReviewRevision: current.currentMaterialReviewRevision,
          requestedMaterialReviewRevision: input.materialReviewRevision,
        },
      ),
    )
  }
  if (
    input.openedReason === 'manual_reopen' &&
    input.materialReviewRevision !== current.currentMaterialReviewRevision
  ) {
    return err(
      inboxError(
        'invalid_input',
        'A manual reopen must keep the current Material Review Revision',
        {
          currentMaterialReviewRevision: current.currentMaterialReviewRevision,
          requestedMaterialReviewRevision: input.materialReviewRevision,
        },
      ),
    )
  }

  const cycleNumber = current.currentCycleNumber + 1
  const stateRevision = current.stateRevision + 1
  if (!isPositiveSafeInteger(cycleNumber) || !isPositiveSafeInteger(stateRevision)) {
    return err(inboxError('invalid_input', 'Handling Cycle revision limit reached'))
  }

  return ok({
    cycle: {
      inboxItemId: current.inboxItemId,
      cycleNumber,
      organizationId: current.organizationId,
      propertyId: current.propertyId,
      reviewId: current.reviewId,
      materialReviewRevision: input.materialReviewRevision,
      openedReason: input.openedReason,
      supersedesCycleNumber: current.currentCycleNumber,
      openedBy: input.openedBy,
      openedAt: input.openedAt,
    },
    head: {
      ...current,
      currentCycleNumber: cycleNumber,
      currentMaterialReviewRevision: input.materialReviewRevision,
      stateRevision,
      status: 'open',
    },
  })
}
