import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { markFeedbackHandled } from './mark-feedback-handled'
import { correctFeedbackHandlingOutcome } from './correct-feedback-handling-outcome'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  clearInboxOrganization,
  createUseCaseDatabase,
  createUseCaseInboxRepository,
  dropInboxUseCaseTenant,
  openFixturePool,
  runScopedId,
  seedInboxItem,
  seedInboxOrganization,
} from '../../infrastructure/inbox-database-fixtures'
import { createFeedbackHandlingStore } from '../../infrastructure/feedback-handling.store'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'

const NOW = new Date('2026-08-27T12:00:00.000Z')
const ORG_ID = organizationId('org-feedback-handling')
const ITEM_ID = inboxItemId(runScopedId('7a000000-0000-4000-8000-000000000021'))
const REVIEW_ITEM_ID = inboxItemId(runScopedId('7a000000-0000-4000-8000-000000000027'))
const PROPERTY_ID = propertyId(runScopedId('7a000000-0000-4000-8000-000000000022'))
const ACTOR_ID = userId('manager-feedback-handling')
const PRIOR_OUTCOME_ID = runScopedId('7a000000-0000-4000-8000-000000000025')
const OUTCOME_ID = runScopedId('7a000000-0000-4000-8000-000000000026')

const item = (sourceType: 'feedback' | 'review' = 'feedback'): InboxItem => ({
  id: sourceType === 'feedback' ? ITEM_ID : REVIEW_ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  sourceType,
  sourceId:
    sourceType === 'feedback'
      ? feedbackId(runScopedId('7a000000-0000-4000-8000-000000000023'))
      : reviewId(runScopedId('7a000000-0000-4000-8000-000000000024')),
  status: 'open',
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  rating: 2,
  sourceDate: NOW,
  platform: null,
  snippet: 'The room was not ready.',
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: NOW,
  updatedAt: NOW,
})

const ctx = createScopedAuthContext({
  organizationId: ORG_ID,
  userId: ACTOR_ID,
  permissions: [
    ['inbox.write', 'assigned-properties'],
    ['feedback.handle', 'assigned-properties'],
  ],
})

const peopleApi = (propertyIds = [PROPERTY_ID]): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => propertyIds,
  getAssignedPortals: async () => [],
})

const expected = {
  commandRevision: 1,
  cycleNumber: 1,
  sourceRevision: 1,
  stateRevision: 1,
} as const

const deterministicDependencies = {
  clock: () => NOW,
  idGen: () => OUTCOME_ID,
} as const

describe.sequential('feedback handling commands', () => {
  const db = createUseCaseDatabase()
  let pool: Pool

  const setup = async (...seeds: InboxItem[]) => {
    for (const seeded of seeds) await seedInboxItem(pool, db, seeded, () => NOW)
    const repo = createUseCaseInboxRepository(db, () => NOW)
    const realStore = createFeedbackHandlingStore(db, async () => ({ allowed: true }))
    const store = {
      ...realStore,
      markHandled: vi.fn(realStore.markHandled),
      correctOutcome: vi.fn(realStore.correctOutcome),
    }
    return { repo, store }
  }

  beforeAll(async () => {
    pool = openFixturePool()
    clearEventSchemas()
    registerAllEventSchemas()
    await seedInboxOrganization(pool, ORG_ID, [PROPERTY_ID])
  })

  beforeEach(() => clearInboxOrganization(pool, ORG_ID))

  afterAll(async () => {
    clearEventSchemas()
    await dropInboxUseCaseTenant(pool, ORG_ID, [PROPERTY_ID])
    await pool.end()
  })

  describe('markFeedbackHandled', () => {
    it('authorizes the exact private-feedback Property and delegates one outcome', async () => {
      const { repo, store } = await setup(item())
      const execute = markFeedbackHandled({
        repo,
        store,
        staffPublicApi: peopleApi(),
        ...deterministicDependencies,
      })

      const result = await execute(
        {
          inboxItemId: ITEM_ID,
          expected,
          outcome: 'follow_up_attempted',
          internalNote: 'Left a voicemail and sent an email.',
        },
        ctx,
      )

      expect(result.item).toMatchObject({ status: 'closed', commandRevision: 2 })
      expect(result.feedbackHandling.currentOutcome).toMatchObject({
        outcome: 'follow_up_attempted',
        outcomeRevision: 1,
      })
      expect(store.markHandled).toHaveBeenCalledWith(
        expect.objectContaining({
          item: expect.objectContaining({ sourceType: 'feedback' }),
          expected,
          outcome: 'follow_up_attempted',
          actorUserId: ACTOR_ID,
        }),
      )
    })

    it('rejects Review items and inaccessible private feedback', async () => {
      const review = await setup(item('review'))
      const inaccessible = await setup(item())

      await expect(
        markFeedbackHandled({
          repo: review.repo,
          store: review.store,
          staffPublicApi: peopleApi(),
          ...deterministicDependencies,
        })(
          {
            inboxItemId: REVIEW_ITEM_ID,
            expected,
            outcome: 'reviewed_no_additional_step',
            internalNote: null,
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      await expect(
        markFeedbackHandled({
          repo: inaccessible.repo,
          store: inaccessible.store,
          staffPublicApi: peopleApi([]),
          ...deterministicDependencies,
        })(
          {
            inboxItemId: ITEM_ID,
            expected,
            outcome: 'reviewed_no_additional_step',
            internalNote: null,
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(review.store.markHandled).not.toHaveBeenCalled()
      expect(inaccessible.store.markHandled).not.toHaveBeenCalled()
    })
  })

  describe('correctFeedbackHandlingOutcome', () => {
    it('delegates a correction through the same manager authority without reopening', async () => {
      const { repo, store } = await setup(item())
      await store.markHandled({
        item: item(),
        expected,
        outcomeId: PRIOR_OUTCOME_ID,
        outcome: 'follow_up_attempted',
        internalNote: null,
        actorUserId: ACTOR_ID,
        recordedAt: NOW,
      })
      const execute = correctFeedbackHandlingOutcome({
        repo,
        store,
        staffPublicApi: peopleApi(),
        ...deterministicDependencies,
      })

      const result = await execute(
        {
          inboxItemId: ITEM_ID,
          expected: {
            commandRevision: 2,
            cycleNumber: 1,
            sourceRevision: 1,
            stateRevision: 2,
            outcomeRevision: 1,
            outcomeId: PRIOR_OUTCOME_ID,
          },
          outcome: 'handled_with_team',
          internalNote: null,
        },
        ctx,
      )

      expect(result.item).toMatchObject({ status: 'closed', commandRevision: 3 })
      expect(result.feedbackHandling.currentOutcome).toMatchObject({
        outcome: 'handled_with_team',
        outcomeRevision: 2,
      })
      expect(store.correctOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'handled_with_team',
          actorUserId: ACTOR_ID,
        }),
      )
    })
  })
})
