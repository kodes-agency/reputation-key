// D4 settlement helper: the only path from an uncertain attempt to "not
// published, safe to retry", and only on positive non-dispatch evidence.

import { describe, expect, it, vi } from 'vitest'
import {
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { Reply } from '../../domain/types'
import type { ReplyDispatchEvidence } from '../ports/reply-publication-dispatch-evidence.port'
import {
  isUncertainPublicationAttempt,
  settleIfNeverDispatched,
  type NeverDispatchedSettlementDeps,
} from './settle-never-dispatched-attempt'

const NOW = new Date('2026-09-14T12:00:00.000Z')
const STARTED_AT = new Date('2026-09-14T11:00:00.000Z')
const PROP_ID = propertyId('53000000-0000-4000-8000-000000000001')

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: replyId('53000000-0000-4000-8000-000000000020'),
    reviewId: reviewId('53000000-0000-4000-8000-000000000010'),
    organizationId: organizationId('org-settle-never-dispatched'),
    text: 'Thank you!',
    source: 'internal',
    status: 'publish_failed',
    createdBy: userId('user-settle'),
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 2,
    submittedAt: null,
    approvedAt: null,
    publishedAt: null,
    publicationState: 'ambiguous',
    publicationCycle: 3,
    publicationAttempts: 1,
    publicationLastErrorClass: 'ambiguous',
    reconcileDueAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    templateId: null,
    templateVersion: null,
    ...overrides,
  }
}

function makeDeps(
  evidence: ReplyDispatchEvidence,
  options: Readonly<{ startedAt?: Date | null; settled?: Reply | null }> = {},
) {
  const findCurrentPublicationAttemptStartedAt = vi.fn(async () =>
    options.startedAt === undefined ? STARTED_AT : options.startedAt,
  )
  const findDispatchEvidence = vi.fn(async () => evidence)
  const settleNeverDispatchedAttempt = vi.fn(async (reply: Reply) =>
    options.settled === undefined
      ? { ...reply, publicationState: 'terminal' as const, reconcileDueAt: null }
      : options.settled,
  )
  const deps: NeverDispatchedSettlementDeps = {
    replyRepo: { findCurrentPublicationAttemptStartedAt },
    commandStore: { settleNeverDispatchedAttempt },
    dispatchEvidence: { findDispatchEvidence },
    clock: () => NOW,
  }
  return {
    deps,
    findCurrentPublicationAttemptStartedAt,
    findDispatchEvidence,
    settleNeverDispatchedAttempt,
  }
}

describe('isUncertainPublicationAttempt', () => {
  it.each([
    ['approved + sending', { status: 'approved', publicationState: 'sending' }, true],
    ['publish_failed + ambiguous', {}, true],
    ['terminal ambiguity', { publicationState: 'terminal' }, true],
    [
      'terminal retryable failure',
      { publicationState: 'terminal', publicationLastErrorClass: 'retryable' },
      false,
    ],
    [
      'acknowledged write',
      { status: 'approved', publicationState: 'pending_observation' },
      false,
    ],
    ['published row carrying ambiguity', { status: 'published' }, false],
    ['no attempt yet', { publicationAttempts: 0 }, false],
    ['no cycle yet', { publicationCycle: 0 }, false],
  ] as const)('%s → %s', (_name, overrides, expected) => {
    expect(isUncertainPublicationAttempt(makeReply(overrides as Partial<Reply>))).toBe(
      expected,
    )
  })
})

describe('settleIfNeverDispatched', () => {
  it('settles the exact attempt with a publish_failed fact when no permit exists', async () => {
    const reply = makeReply()
    const harness = makeDeps('never_dispatched')

    const result = await settleIfNeverDispatched(harness.deps, {
      reply,
      propertyId: PROP_ID,
    })

    expect(result).toMatchObject({ kind: 'settled', settledAt: NOW })
    expect(harness.findDispatchEvidence).toHaveBeenCalledWith({
      organizationId: reply.organizationId,
      replyId: reply.id,
      publicationCycle: 3,
      attemptNumber: 1,
      attemptStartedAt: STARTED_AT,
      now: NOW,
    })
    expect(harness.settleNeverDispatchedAttempt).toHaveBeenCalledWith(
      reply,
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        replyId: reply.id,
        reviewId: reply.reviewId,
        propertyId: PROP_ID,
        authorId: reply.createdBy,
        occurredAt: NOW,
      }),
      NOW,
    )
  })

  it.each<ReplyDispatchEvidence>(['possibly_dispatched', 'too_recent'])(
    'leaves the attempt untouched when the evidence is %s',
    async (evidence) => {
      const harness = makeDeps(evidence)

      await expect(
        settleIfNeverDispatched(harness.deps, {
          reply: makeReply(),
          propertyId: PROP_ID,
        }),
      ).resolves.toEqual({ kind: 'unproven', evidence })
      expect(harness.settleNeverDispatchedAttempt).not.toHaveBeenCalled()
    },
  )

  it('fails closed when no attempt row dates the attempt', async () => {
    const harness = makeDeps('never_dispatched', { startedAt: null })

    await expect(
      settleIfNeverDispatched(harness.deps, { reply: makeReply(), propertyId: PROP_ID }),
    ).resolves.toEqual({ kind: 'unproven', evidence: 'possibly_dispatched' })
    expect(harness.findDispatchEvidence).not.toHaveBeenCalled()
  })

  it('never asks about a reply that is not an uncertain attempt', async () => {
    const harness = makeDeps('never_dispatched')

    await expect(
      settleIfNeverDispatched(harness.deps, {
        reply: makeReply({ status: 'approved', publicationState: 'pending_observation' }),
        propertyId: PROP_ID,
      }),
    ).resolves.toEqual({ kind: 'unproven', evidence: 'possibly_dispatched' })
    expect(harness.findCurrentPublicationAttemptStartedAt).not.toHaveBeenCalled()
    expect(harness.findDispatchEvidence).not.toHaveBeenCalled()
  })

  it('reports a lost compare-and-set as superseded', async () => {
    const harness = makeDeps('never_dispatched', { settled: null })

    await expect(
      settleIfNeverDispatched(harness.deps, { reply: makeReply(), propertyId: PROP_ID }),
    ).resolves.toEqual({ kind: 'superseded' })
  })
})
