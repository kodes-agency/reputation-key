// Who a reply's outcome is news to.
//
// A draft is often started by one manager and finished by another: the item
// is handed on, and the second manager rewrites the text or accepts an AI
// suggestion over it, then submits. The decision and publication facts named
// the reply's creator as its author, so "Your reply needs changes" went to
// the manager who had moved on, and the one waiting on the decision heard
// nothing. They now name whoever put the reply up for approval.

import { describe, expect, it, vi } from 'vitest'
import type { DomainEvent } from '#/shared/events/events'
import {
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
  type UserId,
} from '#/shared/domain/ids'
import type { Reply, Review } from '../../domain/types'
import type { ConditionalReplyUpdate } from '../ports/reply.repository'
import {
  approveReply,
  rejectReply,
  submitReply,
  type ReplyDeps,
} from './reply-operations'

const ORG = organizationId('org-reply-outcome-author')
const PROPERTY = propertyId('52000000-0000-4000-8000-000000000001')
const REVIEW = reviewId('52000000-0000-4000-8000-000000000010')
const REPLY = replyId('52000000-0000-4000-8000-000000000020')
const CREATOR = userId('reply-creator')
const SUBMITTER = userId('reply-submitter')
const APPROVER = userId('reply-approver')
const NOW = new Date('2026-09-20T12:00:00.000Z')

const reply = (overrides: Partial<Reply>): Reply => ({
  id: REPLY,
  reviewId: REVIEW,
  organizationId: ORG,
  text: 'Thank you for staying with us.',
  templateId: null,
  templateVersion: null,
  status: 'pending_approval',
  source: 'internal',
  createdBy: CREATOR,
  approvedBy: null,
  rejectedBy: null,
  rejectionReason: null,
  aiGenerated: false,
  stateRevision: 2,
  submittedAt: NOW,
  approvedAt: null,
  publishedAt: null,
  publicationState: null,
  publicationCycle: 0,
  publicationAttempts: 0,
  publicationLastErrorClass: null,
  reconcileDueAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
})

const review = {
  id: REVIEW,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceEpoch: 0,
  sourceRevision: 1,
}

const makeDeps = (current: Reply) => {
  const events: DomainEvent[] = []
  const patches: ConditionalReplyUpdate[] = []
  const apply = async (
    saved: Reply,
    updates: ConditionalReplyUpdate,
    event: DomainEvent | null,
  ): Promise<Reply> => {
    patches.push(updates)
    if (event) events.push(event)
    return { ...saved, ...updates } as Reply
  }
  const deps = {
    replyRepo: { findInternalByReviewId: vi.fn(async () => current) },
    reviewRepo: { findById: vi.fn(async () => review as unknown as Review) },
    staffPublicApi: {
      getAccessiblePropertyIds: async () => null,
      getAssignedPortals: async () => [],
    },
    queue: { addPublishJob: vi.fn(async () => {}) },
    googleReplyObservationStore: { findCurrentHead: vi.fn(async () => null) },
    propertyPublicationScope: {
      getPublicationScope: vi.fn(async () => ({ lifecycle: 'active', sourceEpoch: 0 })),
    },
    commandStore: {
      submitReply: (saved: Reply, updates: ConditionalReplyUpdate, event: DomainEvent) =>
        apply(saved, updates, event),
      rejectReply: (saved: Reply, updates: ConditionalReplyUpdate, event: DomainEvent) =>
        apply(saved, updates, event),
      markPublicationAuthorized: (
        saved: Reply,
        updates: ConditionalReplyUpdate,
        facts: { lifecycleEvent: DomainEvent | null },
      ) =>
        apply(
          saved,
          { ...updates, publicationState: 'authorized' },
          facts.lifecycleEvent,
        ),
    },
    clock: () => NOW,
    idGen: () => REPLY,
  } as unknown as ReplyDeps
  return { deps, events, patches }
}

const ctx = (actor: UserId) =>
  ({ role: 'PropertyManager', userId: actor, organizationId: ORG }) as const

const authorOf = (events: readonly DomainEvent[], tag: string) =>
  (events.find((event) => event._tag === tag) as { authorId: UserId | null } | undefined)
    ?.authorId

describe('who a reply decision is addressed to', () => {
  it('records who put the reply up for approval', async () => {
    const { deps, patches } = makeDeps(reply({ status: 'draft', submittedAt: null }))

    await submitReply(deps)({ reviewId: REVIEW }, ctx(SUBMITTER))

    expect(patches[0]).toMatchObject({
      status: 'pending_approval',
      submittedBy: SUBMITTER,
    })
  })

  it('tells the submitter, not the creator, that their reply needs changes', async () => {
    const { deps, events } = makeDeps(reply({ submittedBy: SUBMITTER }))

    await rejectReply(deps)({ reviewId: REVIEW, reason: 'Too long' }, ctx(APPROVER))

    expect(authorOf(events, 'review.reply.rejected')).toBe(SUBMITTER)
  })

  // The creator approving somebody else's submission used to be read as
  // "deciding on your own reply", so the submitter was never told.
  it('tells the submitter it was approved, even when the creator approved it', async () => {
    const { deps, events } = makeDeps(reply({ submittedBy: SUBMITTER }))

    await approveReply(deps)({ reviewId: REVIEW }, ctx(CREATOR))

    expect(authorOf(events, 'review.reply.approved')).toBe(SUBMITTER)
  })

  it('falls back to the creator for a reply submitted before that was recorded', async () => {
    const { deps, events } = makeDeps(reply({}))

    await rejectReply(deps)({ reviewId: REVIEW }, ctx(APPROVER))

    expect(authorOf(events, 'review.reply.rejected')).toBe(CREATOR)
  })
})
