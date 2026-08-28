import { err, ok, type Result } from '#/shared/domain'
import type {
  FeedbackId,
  InboxItemId,
  OrganizationId,
  PropertyId,
  ReviewId,
  UserId,
} from '#/shared/domain/ids'
import { inboxError, type InboxError } from './errors'
import type {
  HandlingCycle,
  HandlingCycleActorType,
  HandlingCycleCloseReason,
  HandlingCycleHead,
  HandlingCycleTransition,
  SourceType,
} from './types'
import type { ManualReopenReason } from './types'

type SourceId = ReviewId | FeedbackId

export type HandlingCycleDecision = Readonly<{
  cycle: HandlingCycle
  head: HandlingCycleHead
  transitions: ReadonlyArray<HandlingCycleTransition>
}>

const isPositiveSafeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0

export type CreateInitialHandlingCycleInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: SourceId
  sourceRevision: number
  openedReason: 'legacy_backfill' | 'review_observed' | 'feedback_submitted'
  actorType: HandlingCycleActorType
  triggerEventId: string | null
  openedAt: Date
  status: HandlingCycleHead['status']
}>

/** Build cycle one without copying provider/private content. */
export function createInitialHandlingCycle(
  input: CreateInitialHandlingCycleInput,
): Result<HandlingCycleDecision, InboxError> {
  if (!isPositiveSafeInteger(input.sourceRevision)) {
    return err(
      inboxError('invalid_input', 'Handling Cycle source revision must be positive', {
        sourceRevision: input.sourceRevision,
      }),
    )
  }

  if (
    (input.sourceType === 'review' && input.openedReason === 'feedback_submitted') ||
    (input.sourceType === 'feedback' && input.openedReason === 'review_observed')
  ) {
    return err(
      inboxError('invalid_input', 'Handling Cycle opening reason does not match source'),
    )
  }

  const scope = {
    inboxItemId: input.inboxItemId,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
  }
  const cycle = {
    ...scope,
    cycleNumber: 1,
    sourceRevision: input.sourceRevision,
    openedReason: input.openedReason,
    manualReopenReason: null,
    manualReopenExplanation: null,
    supersedesCycleNumber: null,
    openedBy: null,
    openedAt: input.openedAt,
  } satisfies HandlingCycle
  const head = {
    ...scope,
    currentCycleNumber: 1,
    currentSourceRevision: input.sourceRevision,
    stateRevision: 1,
    status: input.status,
  } satisfies HandlingCycleHead
  return ok({
    cycle,
    head,
    transitions: [
      {
        ...scope,
        cycleNumber: 1,
        stateRevision: 1,
        sourceRevision: input.sourceRevision,
        kind: 'opened',
        transitionReason: input.openedReason,
        actorType: input.actorType,
        actorUserId: null,
        triggerEventId: input.triggerEventId,
        transitionedAt: input.openedAt,
      },
    ],
  })
}

export type CreateNextHandlingCycleInput = Readonly<{
  current: HandlingCycleHead
  sourceRevision: number
  openedReason:
    | 'material_revision_changed'
    | 'feedback_submitted'
    | 'manual_reopen'
    | 'provider_reply_deleted'
    | 'provider_reply_diverged'
  manualReopenReason?: ManualReopenReason
  manualReopenExplanation?: string | null
  openedBy: UserId | null
  actorType: HandlingCycleActorType
  triggerEventId: string | null
  openedAt: Date
}>

/**
 * Decide the next append-only cycle and CAS head. Manual reopen deliberately
 * permits another cycle on the same source revision; a material-change trigger
 * must advance it.
 */
export function createNextHandlingCycle(
  input: CreateNextHandlingCycleInput,
): Result<HandlingCycleDecision, InboxError> {
  const { current } = input
  if (
    !isPositiveSafeInteger(current.currentCycleNumber) ||
    !isPositiveSafeInteger(current.currentSourceRevision) ||
    !isPositiveSafeInteger(current.stateRevision) ||
    !isPositiveSafeInteger(input.sourceRevision)
  ) {
    return err(inboxError('invalid_input', 'Handling Cycle revisions must be positive'))
  }

  let manualReopenReason: ManualReopenReason | null = null
  let manualReopenExplanation: string | null = null
  if (input.openedReason === 'manual_reopen') {
    if (current.status !== 'closed') {
      return err(
        inboxError('invalid_input', 'Only a closed Handling Cycle can be reopened'),
      )
    }
    if (!input.openedBy) {
      return err(inboxError('invalid_input', 'A manual reopen requires an actor'))
    }
    if (input.actorType !== 'user') {
      return err(inboxError('invalid_input', 'A manual reopen requires a user actor'))
    }
    if (!input.manualReopenReason) {
      return err(inboxError('invalid_input', 'A manual reopen reason is required'))
    }
    manualReopenReason = input.manualReopenReason
    if (manualReopenReason === 'other') {
      const explanation = input.manualReopenExplanation?.trim() ?? ''
      if (explanation.length < 1 || explanation.length > 280) {
        return err(
          inboxError(
            'invalid_input',
            'Other manual reopen reason requires a short explanation',
          ),
        )
      }
      manualReopenExplanation = explanation
    } else if (input.manualReopenExplanation != null) {
      return err(
        inboxError(
          'invalid_input',
          'A manual reopen explanation is only valid for Other',
        ),
      )
    }
  } else if (
    input.manualReopenReason !== undefined ||
    input.manualReopenExplanation !== undefined
  ) {
    return err(
      inboxError('invalid_input', 'System-opened cycles cannot carry a reopen reason'),
    )
  }

  if (
    input.openedReason === 'material_revision_changed' &&
    (current.sourceType !== 'review' ||
      input.sourceRevision <= current.currentSourceRevision)
  ) {
    return err(
      inboxError(
        'invalid_input',
        'A material-change cycle must advance the Material Review Revision',
        {
          currentSourceRevision: current.currentSourceRevision,
          requestedSourceRevision: input.sourceRevision,
        },
      ),
    )
  }
  if (
    input.openedReason === 'feedback_submitted' &&
    (current.sourceType !== 'feedback' ||
      input.sourceRevision <= current.currentSourceRevision)
  ) {
    return err(
      inboxError(
        'invalid_input',
        'A new private-feedback occurrence must advance the Guest revision',
      ),
    )
  }
  if (
    (input.openedReason === 'provider_reply_deleted' ||
      input.openedReason === 'provider_reply_diverged') &&
    current.status !== 'closed'
  ) {
    return err(
      inboxError('invalid_input', 'Only a closed Handling Cycle can be reopened'),
    )
  }
  if (
    input.openedReason !== 'material_revision_changed' &&
    input.openedReason !== 'feedback_submitted' &&
    input.sourceRevision !== current.currentSourceRevision
  ) {
    return err(
      inboxError(
        'invalid_input',
        'A same-source reopen must keep the current Material Review Revision',
        {
          currentSourceRevision: current.currentSourceRevision,
          requestedSourceRevision: input.sourceRevision,
        },
      ),
    )
  }

  const closesCurrent = current.status === 'open'
  const cycleNumber = current.currentCycleNumber + 1
  const stateRevision = current.stateRevision + (closesCurrent ? 2 : 1)
  if (!isPositiveSafeInteger(cycleNumber) || !isPositiveSafeInteger(stateRevision)) {
    return err(inboxError('invalid_input', 'Handling Cycle revision limit reached'))
  }

  const cycle = {
    inboxItemId: current.inboxItemId,
    cycleNumber,
    organizationId: current.organizationId,
    propertyId: current.propertyId,
    sourceType: current.sourceType,
    sourceId: current.sourceId,
    sourceRevision: input.sourceRevision,
    openedReason: input.openedReason,
    manualReopenReason,
    manualReopenExplanation,
    supersedesCycleNumber: current.currentCycleNumber,
    openedBy: input.openedBy,
    openedAt: input.openedAt,
  } satisfies HandlingCycle
  const head = {
    ...current,
    currentCycleNumber: cycleNumber,
    currentSourceRevision: input.sourceRevision,
    stateRevision,
    status: 'open',
  } satisfies HandlingCycleHead
  const transitions: HandlingCycleTransition[] = []
  if (closesCurrent) {
    transitions.push({
      inboxItemId: current.inboxItemId,
      cycleNumber: current.currentCycleNumber,
      stateRevision: current.stateRevision + 1,
      organizationId: current.organizationId,
      propertyId: current.propertyId,
      sourceType: current.sourceType,
      sourceId: current.sourceId,
      sourceRevision: current.currentSourceRevision,
      kind: 'closed',
      transitionReason: 'superseded_by_source_revision',
      actorType: input.actorType,
      actorUserId: input.openedBy,
      triggerEventId: input.triggerEventId,
      transitionedAt: input.openedAt,
    })
  }
  transitions.push({
    inboxItemId: current.inboxItemId,
    cycleNumber,
    stateRevision,
    organizationId: current.organizationId,
    propertyId: current.propertyId,
    sourceType: current.sourceType,
    sourceId: current.sourceId,
    sourceRevision: input.sourceRevision,
    kind:
      input.openedReason === 'material_revision_changed' ||
      input.openedReason === 'feedback_submitted'
        ? 'opened'
        : 'reopened',
    transitionReason:
      input.openedReason === 'manual_reopen' ? manualReopenReason! : input.openedReason,
    actorType: input.actorType,
    actorUserId: input.openedBy,
    triggerEventId: input.triggerEventId,
    transitionedAt: input.openedAt,
  })
  return ok({ cycle, head, transitions })
}

export type CloseHandlingCycleInput = Readonly<{
  current: HandlingCycleHead
  closeReason: HandlingCycleCloseReason
  actorType: HandlingCycleActorType
  actorUserId: UserId | null
  triggerEventId: string | null
  closedAt: Date
}>

export function closeHandlingCycle(
  input: CloseHandlingCycleInput,
): Result<
  Readonly<{ head: HandlingCycleHead; transition: HandlingCycleTransition }>,
  InboxError
> {
  const { current } = input
  if (current.status !== 'open') {
    return err(inboxError('invalid_transition', 'Handling Cycle is already closed'))
  }
  if ((input.actorType === 'user') !== (input.actorUserId !== null)) {
    return err(inboxError('invalid_input', 'Handling Cycle actor attribution is invalid'))
  }
  const stateRevision = current.stateRevision + 1
  if (!isPositiveSafeInteger(stateRevision)) {
    return err(inboxError('invalid_input', 'Handling Cycle revision limit reached'))
  }
  const head = { ...current, stateRevision, status: 'closed' as const }
  return ok({
    head,
    transition: {
      inboxItemId: current.inboxItemId,
      cycleNumber: current.currentCycleNumber,
      stateRevision,
      organizationId: current.organizationId,
      propertyId: current.propertyId,
      sourceType: current.sourceType,
      sourceId: current.sourceId,
      sourceRevision: current.currentSourceRevision,
      kind: 'closed',
      transitionReason: input.closeReason,
      actorType: input.actorType,
      actorUserId: input.actorUserId,
      triggerEventId: input.triggerEventId,
      transitionedAt: input.closedAt,
    },
  })
}

/** Compatibility wrappers for existing Review-only call sites. */
export type CreateInitialReviewHandlingCycleInput = Omit<
  CreateInitialHandlingCycleInput,
  | 'sourceType'
  | 'sourceId'
  | 'sourceRevision'
  | 'openedReason'
  | 'actorType'
  | 'triggerEventId'
> &
  Readonly<{ reviewId: ReviewId; materialReviewRevision: number }>

export function createInitialReviewHandlingCycle(
  input: CreateInitialReviewHandlingCycleInput,
) {
  const decision = createInitialHandlingCycle({
    ...input,
    sourceType: 'review',
    sourceId: input.reviewId,
    sourceRevision: input.materialReviewRevision,
    openedReason: 'review_observed',
    actorType: 'provider',
    triggerEventId: null,
  })
  if (decision.isErr()) return decision
  return ok({
    ...decision.value,
    cycle: {
      ...decision.value.cycle,
      sourceType: 'review' as const,
      sourceId: input.reviewId,
      reviewId: input.reviewId,
      materialReviewRevision: input.materialReviewRevision,
    },
    head: {
      ...decision.value.head,
      sourceType: 'review' as const,
      sourceId: input.reviewId,
      reviewId: input.reviewId,
      currentMaterialReviewRevision: input.materialReviewRevision,
    },
  })
}

export type CreateNextReviewHandlingCycleInput = Omit<
  CreateNextHandlingCycleInput,
  'current' | 'sourceRevision' | 'actorType' | 'triggerEventId'
> &
  Readonly<{
    current: import('./types').ReviewHandlingCycleHead
    materialReviewRevision: number
  }>

export function createNextReviewHandlingCycle(input: CreateNextReviewHandlingCycleInput) {
  const decision = createNextHandlingCycle({
    ...input,
    current: {
      inboxItemId: input.current.inboxItemId,
      organizationId: input.current.organizationId,
      propertyId: input.current.propertyId,
      sourceType: 'review',
      sourceId: input.current.reviewId,
      currentCycleNumber: input.current.currentCycleNumber,
      currentSourceRevision: input.current.currentMaterialReviewRevision,
      stateRevision: input.current.stateRevision,
      status: input.current.status,
    },
    sourceRevision: input.materialReviewRevision,
    actorType: input.openedBy ? 'user' : 'provider',
    triggerEventId: null,
  })
  if (decision.isErr()) return decision
  return ok({
    ...decision.value,
    cycle: {
      ...decision.value.cycle,
      sourceType: 'review' as const,
      sourceId: input.current.reviewId,
      reviewId: input.current.reviewId,
      materialReviewRevision: input.materialReviewRevision,
    },
    head: {
      ...decision.value.head,
      sourceType: 'review' as const,
      sourceId: input.current.reviewId,
      reviewId: input.current.reviewId,
      currentMaterialReviewRevision: input.materialReviewRevision,
    },
  })
}
