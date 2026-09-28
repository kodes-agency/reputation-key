import { describe, expect, it } from 'vitest'
import { inboxItemId, organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { inboxItemCreated } from '../domain/events'
import type { InboxItem } from '../domain/types'
import type {
  CurrentReviewInboxProjectionPermit,
  ReviewInboxProjectionRevisionPermit,
} from '../application/ports/review-response-target-authority.port'
import { assertReviewProjectionCommand } from './inbox-command-guards'

const ORG = organizationId('org-guard-epoch-carry')
const PROPERTY = propertyId('7e000000-0000-4000-8000-000000000001')
const REVIEW = reviewId('7e000000-0000-4000-8000-000000000002')
const ITEM = inboxItemId('7e000000-0000-4000-8000-000000000003')
const FIRST_SEEN = new Date('2026-08-01T12:00:00.000Z')

const item: InboxItem = {
  id: ITEM,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceType: 'review',
  sourceId: REVIEW,
  status: 'open',
  rating: null,
  sourceDate: FIRST_SEEN,
  platform: 'google',
  snippet: null,
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: FIRST_SEEN,
  updatedAt: FIRST_SEEN,
}

const revision = (
  materialReviewRevision: number,
  sourceEpoch: number,
  sourceEpochCarry = false,
): ReviewInboxProjectionRevisionPermit => ({
  authority: 'review.inbox-projection-revision.v1',
  organizationId: ORG,
  propertyId: PROPERTY,
  reviewId: REVIEW,
  sourceEpoch,
  materialReviewRevision,
  eligibility: 'legacy_unknown',
  responseTargetStartAt: null,
  rating: 4,
  observedAt: new Date(FIRST_SEEN.getTime() + materialReviewRevision - 1),
  sourceEpochCarry,
})

const apply = (
  sourceEpoch: number,
  revisions: readonly [
    ReviewInboxProjectionRevisionPermit,
    ...ReviewInboxProjectionRevisionPermit[],
  ],
) => {
  const projection: CurrentReviewInboxProjectionPermit = {
    authority: 'review.current-inbox-projection.v1',
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: REVIEW,
    sourceEpoch,
    platform: 'google',
    sourceDate: FIRST_SEEN,
    sourceContentState: 'active',
    sourceContentErasedAt: null,
    currentMaterialReviewRevision: revisions.length,
    revisions,
  }
  return () =>
    assertReviewProjectionCommand({
      eventId: 'evt-epoch-carry',
      consumerName: 'inbox.on-review-updated',
      eventKind: 'updated',
      item,
      fact: inboxItemCreated({
        inboxItemId: ITEM,
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceType: 'review',
        sourceId: REVIEW,
        occurredAt: FIRST_SEEN,
      }),
      projection,
      now: FIRST_SEEN,
    })
}

const invalidInput = expect.objectContaining({ code: 'invalid_input' })

describe('Review projection history across a source-epoch change', () => {
  it('accepts a history carried into a newer epoch and edited there', () => {
    expect(apply(1, [revision(1, 0), revision(2, 1, true), revision(3, 1)])).not.toThrow()
  })

  it('rejects a carry that did not cross a source epoch', () => {
    expect(apply(0, [revision(1, 0), revision(2, 0, true)])).toThrowError(invalidInput)
    expect(apply(1, [revision(1, 1, true)])).toThrowError(invalidInput)
  })

  it('rejects a history that goes back an epoch or stops short of the current one', () => {
    expect(apply(1, [revision(1, 1), revision(2, 0)])).toThrowError(invalidInput)
    expect(apply(1, [revision(1, 0), revision(2, 0)])).toThrowError(invalidInput)
    expect(apply(0, [revision(1, 0), revision(2, 1)])).toThrowError(invalidInput)
  })
})
