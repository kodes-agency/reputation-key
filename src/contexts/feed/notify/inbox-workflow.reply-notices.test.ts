import { describe, expect, it } from 'vitest'
import { handleWorkflowNotificationEvent } from './inbox-workflow.server'
import { NOTIF_TEST_IDS } from '../infrastructure/notification-consumer-test-fixtures'
import {
  firstJob,
  makeWorkflowDeps,
  publishFailedPayload,
  recordedEvent,
  renderedFor,
  type WorkflowTestDeps as Deps,
  workflowEvent as event,
} from './workflow-consumer.test-fixtures'
import { unbrand } from '#/shared/domain/ids'
import {
  reviewReplyPublishFailed,
  reviewReplyRejected,
} from '#/contexts/reputation/domain/review-events'

const makeDeps = makeWorkflowDeps
const IDS = NOTIF_TEST_IDS

describe('durable workflow notification consumers', () => {
  describe('a reply that failed to publish', () => {
    const publishFailed = (authorId: string | null) =>
      event('review.reply.publish_failed', publishFailedPayload(authorId))

    it('goes to the author while they can still act on the Property', async () => {
      const deps = makeDeps()

      await handleWorkflowNotificationEvent(deps, publishFailed(IDS.authorId))

      expect(deps.fakes.jobs.map((job) => job.data)).toEqual([
        expect.objectContaining({
          userId: IDS.authorId,
          type: 'reply.publish_failed',
          audience: { kind: 'property_operator' },
        }),
      ])
    })

    it.each([
      ['has left the Property', unbrand(IDS.authorId)],
      ['is unknown', null],
    ])(
      'goes to the Property responsible managers when the author %s',
      async (_label, authorId) => {
        const deps = makeDeps()
        deps.fakes.responsibleManagers.isEligibleForProperty.mockResolvedValue(false)

        await handleWorkflowNotificationEvent(deps, publishFailed(authorId))

        expect(deps.fakes.jobs.map((job) => job.data)).toEqual([
          expect.objectContaining({
            userId: IDS.manager1,
            type: 'reply.publish_failed',
            audience: {
              kind: 'responsible_scope',
              scope: { kind: 'property', propertyId: IDS.propId },
            },
          }),
        ])
      },
    )
  })

  describe('a publication that was cancelled after approval', () => {
    // This fact's identifiers are strictly UUID, unlike the older reply
    // families, so its envelope cannot reuse the short test ids.
    const CANCELLED_IDS = {
      replyId: '30000000-0000-4000-8000-0000000000c1',
      reviewId: '30000000-0000-4000-8000-0000000000c2',
      propertyId: '30000000-0000-4000-8000-0000000000c3',
    } as const

    type Cause =
      'disconnect' | 'policy' | 'source_changed' | 'provider_truth' | 'ai_draft_withdrawn'

    const cancelled = (cause: Cause, authorId: string | null = unbrand(IDS.authorId)) =>
      event(
        'review.reply.publication_cancelled',
        { ...CANCELLED_IDS, authorId, cause },
        { propertyId: CANCELLED_IDS.propertyId },
      )

    // No responsible manager may approve, so the approvers are the admins;
    // the responsible-approver tier has its own suite
    // (workflow-publication-cancelled-audience.test.ts).
    const adminFallbackDeps = () => {
      const deps = makeDeps()
      deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([])
      return deps
    }

    const author = { userId: IDS.authorId, audience: { kind: 'property_operator' } }
    const admin = (userId: string) => ({ userId, audience: { kind: 'account_admin' } })

    const rows: readonly {
      name: string
      cause: Cause
      authorId?: string | null
      arrange?: (deps: Deps) => void
      expected: readonly Record<string, unknown>[]
    }[] = [
      {
        name: 'tells the author and, with no responsible approver, the admins',
        cause: 'disconnect',
        arrange: (deps) =>
          deps.fakes.userLookup.findByRole.mockResolvedValue([IDS.admin1, IDS.admin2]),
        expected: [author, admin(IDS.admin1), admin(IDS.admin2)],
      },
      {
        name: 'tells the admins alone when the fact names no author',
        cause: 'source_changed',
        authorId: null,
        expected: [{ userId: IDS.admin1 }],
      },
      {
        name: 'names an author who is also an admin once',
        cause: 'provider_truth',
        arrange: (deps) =>
          deps.fakes.userLookup.findByRole.mockResolvedValue([IDS.authorId]),
        expected: [author],
      },
      // A policy cancellation is what an Archive or a lost authority looks
      // like: the approver it took the authority from cannot re-approve.
      {
        name: 'leaves out an approver who just lost authority over the Property',
        cause: 'policy',
        arrange: (deps) => {
          deps.fakes.userLookup.findByRole.mockResolvedValue([IDS.admin1, IDS.admin2])
          deps.fakes.responsibleManagers.isEligibleForProperty.mockImplementation(
            async (_org: unknown, _property: unknown, user: unknown) =>
              user !== IDS.admin2,
          )
        },
        expected: [{ userId: IDS.authorId }, { userId: IDS.admin1 }],
      },
      {
        name: 'keeps every approver for a cancellation that took nobody’s authority',
        cause: 'disconnect',
        arrange: (deps) => {
          deps.fakes.userLookup.findByRole.mockResolvedValue([IDS.admin1])
          deps.fakes.responsibleManagers.isEligibleForProperty.mockResolvedValue(false)
        },
        expected: [{ userId: IDS.authorId }, { userId: IDS.admin1 }],
      },
    ]

    for (const { name, cause, authorId, arrange, expected } of rows) {
      it(name, async () => {
        const deps = adminFallbackDeps()
        arrange?.(deps)

        await handleWorkflowNotificationEvent(
          deps,
          authorId === undefined ? cancelled(cause) : cancelled(cause, authorId),
        )

        expect(deps.fakes.jobs.map((job) => job.data)).toEqual(
          expected.map((entry) =>
            expect.objectContaining({ ...entry, type: 'reply.publication_cancelled' }),
          ),
        )
      })
    }

    it.each([
      [
        'disconnect',
        'The Google connection was disconnected before it went out. The draft is saved: reconnect Google, then approve it again.',
      ],
      [
        'policy',
        'This property can no longer publish to Google, so it was never sent. The draft is saved.',
      ],
      [
        'source_changed',
        'The guest changed their review, so RepKey stopped the reply that was written before the change. Open it to check what Google shows, then reply to the new review.',
      ],
      [
        'provider_truth',
        'A different reply is live on Google, so this one is not. Open it to check.',
      ],
    ] as const)('says why it was cancelled for cause %s', async (cause, body) => {
      const deps = adminFallbackDeps()

      await handleWorkflowNotificationEvent(deps, cancelled(cause))

      expect(renderedFor(deps, 'reply.publication_cancelled')).toMatchObject({
        title: 'Reply returned to draft at Riverside Hotel',
        body,
      })
    })

    // The AI draft purge's cause has to survive the payload allowlist, or the
    // notice falls back to "Reply returned to draft" for a draft that is gone.
    it('says an AI draft was removed when the purge withdrew it', async () => {
      const deps = adminFallbackDeps()

      await handleWorkflowNotificationEvent(deps, cancelled('ai_draft_withdrawn'))

      expect(renderedFor(deps, 'reply.publication_cancelled')).toMatchObject({
        title: 'AI draft removed at Riverside Hotel',
        actionLabel: 'Open review',
      })
    })
  })

  it('carries what happened to an unpublished reply from its recorded fact', async () => {
    const deps = makeDeps()

    await handleWorkflowNotificationEvent(
      deps,
      recordedEvent(
        reviewReplyPublishFailed({
          replyId: IDS.replyId,
          reviewId: IDS.reviewId,
          propertyId: IDS.propId,
          organizationId: IDS.orgId,
          authorId: IDS.authorId,
          outcome: 'unconfirmed',
          occurredAt: IDS.now,
        }),
      ),
    )

    expect(firstJob(deps).payload).toMatchObject({ publishOutcome: 'unconfirmed' })
    expect(renderedFor(deps, 'reply.publish_failed')).toMatchObject({
      title: 'Reply not confirmed on Google at Riverside Hotel',
      actionLabel: 'View reply',
    })
  })

  describe('a rejected reply recorded through the outbox', () => {
    const deliverRejection = async (reason: string | null) => {
      const deps = makeDeps()
      const recorded = recordedEvent(
        reviewReplyRejected({
          replyId: IDS.replyId,
          reviewId: IDS.reviewId,
          propertyId: IDS.propId,
          organizationId: IDS.orgId,
          userId: IDS.admin1,
          authorId: IDS.authorId,
          reason,
          occurredAt: IDS.now,
        }),
      )
      await handleWorkflowNotificationEvent(deps, recorded)
      return {
        recorded,
        data: firstJob(deps),
        body: renderedFor(deps, 'reply.rejected').body,
      }
    }

    it('tells the author a reason is waiting without carrying its words', async () => {
      const { recorded, data, body } = await deliverRejection(
        'Too defensive, drop the refund mention',
      )

      expect(body).toBe(
        'The approver left a reason. Open the reply to read it, then edit and resubmit.',
      )
      expect(JSON.stringify([recorded, data])).not.toContain('refund')
    })

    it('says there was no reason only when the approver gave none', async () => {
      const { data, body } = await deliverRejection(null)

      // Explicit, so a later reasonless rejection that coalesces into an
      // unread row replaces "a reason is waiting" (newest wins per key).
      expect(data.payload).toMatchObject({ hasModerationReason: false })
      expect(body).toBe('It was sent back without a reason. Edit it and resubmit.')
    })
  })
})
