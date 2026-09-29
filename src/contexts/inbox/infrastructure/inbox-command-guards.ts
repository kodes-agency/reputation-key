// Pure predicates, row mappers, and fact builders for the atomic inbox
// command store (BQC-3.4). Split out of inbox-command-store.ts (code-health-02
// phase 1): every export here is side-effect free — no `Tx`, no query, no
// mutation — so it carries none of the transactional command handlers and
// none of the `inbox_items` writers inbox-status-mirror.guard.test.ts fences.
// inbox-command-store.ts imports from this module; this module must never
// import back from it (that would be a circular dependency).

import type {
  HandlingCycleHead,
  HandlingCycleTransition,
  InboxItem,
} from '../domain/types'
import { inboxError } from '../domain/errors'
import {
  inboxHandlingCycleClosed,
  inboxHandlingCycleOpened,
  inboxHandlingCycleReopened,
  type InboxItemCreated,
} from '../domain/events'
import type { DomainEvent } from '#/shared/events/events'
import { inboxItemFromRow } from './mappers/inbox.mapper'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  type UserId,
} from '#/shared/domain/ids'
import type { Permission } from '#/shared/domain/permissions'
import { inboxHandlingCycleHeads, inboxItems } from '#/shared/db/schema/inbox.schema'
import type {
  ApplyReviewProjectionCommand,
  HandlingCycleCreationAnchor,
  ReviewCycleCreationAnchor,
} from '../application/ports/inbox-command-store.port'
import type { CurrentReplyObservationPermit } from '../application/ports/reply-observation-authority.port'
import type {
  CurrentReviewInboxProjectionPermit,
  ReviewCycleTargetAnchor,
  ReviewInboxProjectionRevisionPermit,
} from '../application/ports/review-response-target-authority.port'

export const sourceCommandPermission = (
  sourceType: InboxItem['sourceType'],
): Permission => (sourceType === 'review' ? 'review.read' : 'feedback.handle')

export const assignmentAuthorityKey = (
  propertyIdValue: string,
  sourceType: (typeof inboxItems.$inferSelect)['sourceType'],
): string => `${propertyIdValue}\u0000${sourceType}`

export const webActorId = (event: DomainEvent | null): string | null => {
  if (
    event === null ||
    !('source' in event) ||
    event.source !== 'web' ||
    !('userId' in event) ||
    typeof event.userId !== 'string'
  ) {
    return null
  }
  return event.userId
}

export type PersistedItem = typeof inboxItems.$inferSelect

export const itemFromRow = (row: PersistedItem): InboxItem => ({
  ...inboxItemFromRow(row),
  propertyName: null,
})

export type PersistedHead = typeof inboxHandlingCycleHeads.$inferSelect

export const handlingCycleHeadFromRow = (row: PersistedHead): HandlingCycleHead => ({
  inboxItemId: inboxItemId(row.inboxItemId),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  sourceType: row.sourceType,
  sourceId:
    row.sourceType === 'review' ? reviewId(row.sourceId) : feedbackId(row.sourceId),
  currentCycleNumber: row.currentCycleNumber,
  currentSourceRevision: row.currentSourceRevision,
  stateRevision: row.stateRevision,
  status: row.status,
})

/**
 * What a transition's command adds to its fact: the bulk reopen it belongs
 * to, or that the command also created the item.
 */
export type LifecycleFactMarks = Readonly<{ bulkId?: string; openedWithItem?: boolean }>

export const lifecycleFactFor = (
  transition: HandlingCycleTransition,
  marks: LifecycleFactMarks = {},
): DomainEvent => {
  const scope = {
    inboxItemId: transition.inboxItemId,
    cycleNumber: transition.cycleNumber,
    stateRevision: transition.stateRevision,
    organizationId: transition.organizationId,
    propertyId: transition.propertyId,
    sourceType: transition.sourceType,
    sourceId: transition.sourceId,
    sourceRevision: transition.sourceRevision,
    actorType: transition.actorType,
    userId: transition.actorUserId,
    triggerEventId: transition.triggerEventId,
    occurredAt: transition.transitionedAt,
  }
  if (transition.kind === 'closed') {
    return inboxHandlingCycleClosed({
      ...scope,
      closeReason: transition.transitionReason as Parameters<
        typeof inboxHandlingCycleClosed
      >[0]['closeReason'],
      source: transition.actorType === 'user' ? 'web' : 'import',
    })
  }
  if (transition.kind === 'reopened') {
    return inboxHandlingCycleReopened({
      ...scope,
      reopenReason: transition.transitionReason as Parameters<
        typeof inboxHandlingCycleReopened
      >[0]['reopenReason'],
      bulkId: marks.bulkId ?? null,
      source: transition.actorType === 'user' ? 'web' : 'import',
    })
  }
  return inboxHandlingCycleOpened({
    ...scope,
    openReason: transition.transitionReason as Parameters<
      typeof inboxHandlingCycleOpened
    >[0]['openReason'],
    openedWithItem: marks.openedWithItem ?? false,
  })
}

export const normalizeCreationAnchor = (
  item: InboxItem,
  anchor: HandlingCycleCreationAnchor | ReviewCycleCreationAnchor,
): HandlingCycleCreationAnchor =>
  'materialReviewRevision' in anchor
    ? {
        sourceRevision: anchor.materialReviewRevision,
        openedReason:
          item.sourceType === 'review' ? 'review_observed' : 'legacy_backfill',
        actorType: 'provider',
        triggerEventId: null,
        openedAt: item.createdAt,
      }
    : anchor

export const projectionTargetAnchor = (
  revision: ReviewInboxProjectionRevisionPermit,
): ReviewCycleTargetAnchor => ({
  reviewAuthority: revision,
  targetStart: { basis: 'review_provenance' },
})

/** Review's current-projection permit must describe exactly the item being written. */
function matchesReviewProjectionAuthority(
  item: InboxItem,
  projection: CurrentReviewInboxProjectionPermit,
): boolean {
  return (
    projection.authority === 'review.current-inbox-projection.v1' &&
    projection.organizationId === item.organizationId &&
    projection.propertyId === item.propertyId &&
    projection.reviewId === item.sourceId &&
    projection.platform === 'google' &&
    item.platform === projection.platform &&
    item.sourceDate.getTime() === projection.sourceDate.getTime() &&
    Number.isSafeInteger(projection.sourceEpoch) &&
    projection.sourceEpoch >= 0 &&
    Number.isSafeInteger(projection.currentMaterialReviewRevision) &&
    projection.currentMaterialReviewRevision >= 1
  )
}

/** The creation fact must name the same item this projection materializes. */
function matchesProjectionCreationFact(fact: InboxItemCreated, item: InboxItem): boolean {
  return (
    fact.inboxItemId === item.id &&
    fact.organizationId === item.organizationId &&
    fact.propertyId === item.propertyId &&
    fact.sourceType === 'review' &&
    fact.sourceId === item.sourceId &&
    fact.occurredAt.getTime() === item.createdAt.getTime()
  )
}

/**
 * A projected item holds no provider content and no Inbox-owned workflow state:
 * rating/snippet/reviewer name stay with Review, and assignment or status
 * changes only ever arrive through their own commands.
 */
function isContentFreeUnhandledReviewItem(item: InboxItem): boolean {
  return (
    item.sourceType === 'review' &&
    item.status === 'open' &&
    item.rating === null &&
    item.snippet === null &&
    item.reviewerName === null &&
    item.assignedTo === null
  )
}

/** An erasure instant is present exactly when the source content is no longer active. */
function hasConsistentProjectionSourceState(
  projection: CurrentReviewInboxProjectionPermit,
): boolean {
  const active = projection.sourceContentState === 'active'
  const erasedAt = projection.sourceContentErasedAt
  if (active && erasedAt !== null) return false
  if (!active && !(erasedAt instanceof Date)) return false
  if (erasedAt instanceof Date && !Number.isFinite(erasedAt.getTime())) return false
  return (
    Number.isFinite(projection.sourceDate.getTime()) && projection.revisions.length > 0
  )
}

/**
 * One entry of the attested revision history: same scope as the item, dense
 * 1-based numbering, non-decreasing observation instants and source epochs, a
 * carry only where the epoch moved on, and a start instant present exactly
 * when the revision was measured.
 */
function isValidProjectionRevision(
  revision: ReviewInboxProjectionRevisionPermit,
  item: InboxItem,
  projection: CurrentReviewInboxProjectionPermit,
  index: number,
  previous: ReviewInboxProjectionRevisionPermit | undefined,
): boolean {
  return (
    revision.authority === 'review.inbox-projection-revision.v1' &&
    revision.organizationId === item.organizationId &&
    revision.propertyId === item.propertyId &&
    revision.reviewId === item.sourceId &&
    revision.sourceEpoch <= projection.sourceEpoch &&
    revision.materialReviewRevision === index + 1 &&
    Number.isFinite(revision.observedAt.getTime()) &&
    (previous === undefined ||
      (revision.observedAt.getTime() >= previous.observedAt.getTime() &&
        revision.sourceEpoch >= previous.sourceEpoch)) &&
    typeof revision.sourceEpochCarry === 'boolean' &&
    (!revision.sourceEpochCarry ||
      (previous !== undefined && previous.sourceEpoch < revision.sourceEpoch)) &&
    (revision.eligibility === 'measured' ||
      revision.eligibility === 'historical_onboarding' ||
      revision.eligibility === 'legacy_unknown') &&
    (revision.eligibility === 'measured') ===
      revision.responseTargetStartAt instanceof Date &&
    !(
      revision.responseTargetStartAt instanceof Date &&
      !Number.isFinite(revision.responseTargetStartAt.getTime())
    )
  )
}

export function assertReviewProjectionCommand(
  command: ApplyReviewProjectionCommand,
): void {
  const { fact, item, projection } = command
  const validSourceState =
    projection.sourceContentState === 'active' ||
    projection.sourceContentState === 'source_expired' ||
    projection.sourceContentState === 'provider_deleted'
  if (
    !isContentFreeUnhandledReviewItem(item) ||
    !matchesReviewProjectionAuthority(item, projection) ||
    !matchesProjectionCreationFact(fact, item) ||
    !validSourceState ||
    !Number.isFinite(command.now.getTime())
  ) {
    throw inboxError(
      'invalid_input',
      'Review Inbox projection authority does not match the projection command',
    )
  }
  if (!hasConsistentProjectionSourceState(projection)) {
    throw inboxError('invalid_input', 'Review Inbox projection source state is invalid')
  }
  for (const [index, revision] of projection.revisions.entries()) {
    const previous = index === 0 ? undefined : projection.revisions[index - 1]
    if (!isValidProjectionRevision(revision, item, projection, index, previous)) {
      throw inboxError(
        'invalid_input',
        'Review Inbox projection revision history is invalid',
      )
    }
  }
  const latest = projection.revisions[projection.revisions.length - 1]
  const erasedAt = projection.sourceContentErasedAt
  if (
    latest?.materialReviewRevision !== projection.currentMaterialReviewRevision ||
    latest.sourceEpoch !== projection.sourceEpoch ||
    item.createdAt.getTime() !== projection.revisions[0].observedAt.getTime() ||
    (erasedAt instanceof Date && erasedAt.getTime() < latest.observedAt.getTime())
  ) {
    throw inboxError(
      'invalid_input',
      'Review Inbox projection head does not match its revision history',
    )
  }
}

/** Review's observation permit must have been issued for this exact Inbox item. */
export function assertObservationMatchesItem(
  observation: CurrentReplyObservationPermit,
  item: InboxItem,
): void {
  if (
    observation.authority !== 'review.current-google-reply-observation.v1' ||
    observation.organizationId !== item.organizationId ||
    observation.propertyId !== item.propertyId ||
    observation.reviewId !== item.sourceId
  ) {
    throw inboxError(
      'invalid_input',
      'Review observation permit does not match the Inbox item',
    )
  }
}

/** Under the bulk lock, both rows must still be exactly what the command was planned against. */
export function matchesLockedBulkAssignState(
  item: InboxItem,
  row: PersistedItem | undefined,
  head: PersistedHead | undefined,
): boolean {
  if (row === undefined || head === undefined) return false
  return (
    row.organizationId === item.organizationId &&
    row.propertyId === item.propertyId &&
    row.sourceType === item.sourceType &&
    row.sourceId === item.sourceId &&
    row.status === item.status &&
    row.assignedTo === item.assignedTo &&
    row.commandRevision === item.commandRevision &&
    head.organizationId === item.organizationId &&
    head.propertyId === item.propertyId &&
    head.sourceType === item.sourceType &&
    head.sourceId === item.sourceId &&
    head.status === item.status
  )
}

/** Assignment-history reason for one bulk transition. */
export function bulkAssignmentReason(
  assignedTo: UserId | null,
  previousAssignee: UserId | null,
  actorId: UserId,
): 'release' | 'claim' | 'assign' | 'reassign' {
  if (assignedTo === null) return 'release'
  if (previousAssignee !== null) return 'reassign'
  return assignedTo === actorId ? 'claim' : 'assign'
}

/**
 * Under the bulk lock, both rows must still be exactly the closed state the
 * command was planned against; anything else is this item's revision conflict.
 */
export function matchesLockedBulkReopenState(
  item: InboxItem,
  itemRow: PersistedItem,
  headRow: PersistedHead,
): boolean {
  return (
    itemRow.organizationId === item.organizationId &&
    itemRow.propertyId === item.propertyId &&
    itemRow.sourceType === item.sourceType &&
    itemRow.sourceId === item.sourceId &&
    itemRow.commandRevision === item.commandRevision &&
    itemRow.status === 'closed' &&
    headRow.organizationId === item.organizationId &&
    headRow.propertyId === item.propertyId &&
    headRow.sourceType === item.sourceType &&
    headRow.sourceId === item.sourceId &&
    headRow.status === 'closed' &&
    itemRow.status === headRow.status
  )
}
