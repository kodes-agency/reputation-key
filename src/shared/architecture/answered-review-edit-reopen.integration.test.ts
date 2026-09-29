import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { sha256Hex } from '#/shared/domain/sha256'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  ANSWERED_EDIT_CLOCK as CLOCK,
  ANSWERED_EDIT_SCOPE as SCOPE,
  answeredEditFixtures,
  type AnsweredEditRevision,
} from '#/shared/testing/answered-review-edit-fixtures'
import { createGoogleReplyObservationStore } from '#/contexts/review/infrastructure/google-reply-observation-store'
import { createReviewReplyObservationAuthority } from '#/contexts/review/infrastructure/reply-observation-authority'
import { createReviewResponseTargetAuthority } from '#/contexts/review/infrastructure/response-target-authority'
import { createAtomicInboxCommandStore } from '#/contexts/inbox/infrastructure/inbox-command-store'
import { createInboxRepository } from '#/contexts/inbox/infrastructure/repositories/inbox.repository'
import { createReviewHandlingCycleStore } from '#/contexts/inbox/infrastructure/review-handling-cycle.store'
import { createReplyObservationAuthorityAdapter } from '#/contexts/inbox/infrastructure/adapters/reply-observation-authority.adapter'
import { createReviewResponseTargetAuthorityAdapter } from '#/contexts/inbox/infrastructure/adapters/review-response-target-authority.adapter'
import {
  handleInboxReplyObserved,
  handleInboxReviewCreated,
  handleInboxReviewUpdated,
  type InboxConsumerDeps,
} from '#/contexts/inbox/infrastructure/outbox-consumers'
import { createInboxItemLookupAdapter } from '#/contexts/feed/infrastructure/adapters/inbox-item-lookup.adapter'
import {
  handleNotificationHandlingCycle,
  type HandlingCycleNotificationConsumerDeps,
} from '#/contexts/feed/infrastructure/handling-cycle-outbox-consumers'
import { handleNotificationInboxItemCreated } from '#/contexts/feed/infrastructure/notification-outbox-consumers'
import {
  createInsertNotificationHandler,
  type InsertNotificationJobData,
} from '#/contexts/feed/infrastructure/jobs/insert-notification.job'
import { createNotificationWorkState } from '#/contexts/feed/application/notification-work-state'
import { resolveCategoryPreference } from '#/contexts/feed/domain/notification-preference-resolution'
import { buildFakeInsertNotificationDeps } from '#/contexts/feed/application/use-cases/test-fixtures'

// End to end, the guest edits a Google review the team had already answered,
// and the owner reply stays live on Google. A reply written for revision 1
// does not answer revision 2 (ADR 0046): Review must not read the old reply as
// answering the edit, Inbox reopens the item and keeps it open, Feed tells the
// responsible manager with the urgent `inbox.reopened`, and only a reply to
// the edited review closes it again — the close that settles the notice.
// The last block proves the same review's arrival notice through the real
// Inbox and Feed's work-state gate: written while unanswered, never after.

const OLD_REPLY = 'Thank you for the five stars!'
const NEW_REPLY = 'We are sorry the second stay let you down.'

let lease: TestLease
let fixtures: ReturnType<typeof answeredEditFixtures>

const lookups = {
  reviewLookup: {
    getReviewSnippetById: async () => ({ status: 'not_found' as const }),
    getReviewSnippetsByIds: async () => new Map(),
    findEligibleReviewIds: async () => [],
  },
  feedbackLookup: {
    getFeedbackSnippetById: async () => null,
    getFeedbackSnippetsByIds: async () => new Map(),
    findEligibleFeedbackIds: async () => [],
  },
  propertyLookup: {
    getPropertyNameById: async () => null,
    getPropertyNamesByIds: async () => new Map(),
  },
}

/** Inbox's durable consumers as production composes them, on the real DB. */
function inboxDeps(): InboxConsumerDeps {
  const db = getDb()
  const logger = createMockLogger()
  const clock = () => CLOCK.deliveredAt
  return {
    commandStore: createAtomicInboxCommandStore(
      db,
      async () => ({ allowed: true }),
      clock,
    ),
    handlingCycleStore: createReviewHandlingCycleStore(db),
    replyObservationAuthority: createReplyObservationAuthorityAdapter(
      createReviewReplyObservationAuthority(db),
    ),
    responseTargetAuthority: createReviewResponseTargetAuthorityAdapter(
      createReviewResponseTargetAuthority(db),
    ),
    sourceTransitionAuthority: { withExactCurrent: async () => ({ status: 'obsolete' }) },
    reviewLookup: lookups.reviewLookup,
    reviewSourceLookup: {
      getReviewSourceMetaById: async () => null,
      getReviewSourceMetaByIds: async () => [],
      listReviewSources: async () => [],
    },
    inboxRepo: createInboxRepository(db, lookups, { clock, logger }),
    idGen: () => SCOPE.itemId,
    clock,
    logger,
  }
}

/** Feed with the real Inbox lookup; one responsible manager; jobs collected. */
function feedDeps() {
  const jobs: unknown[] = []
  const deps: HandlingCycleNotificationConsumerDeps = {
    queue: { add: async (_name: string, data: unknown) => jobs.push(data) },
    userLookup: {
      findByRole: async () => [],
      getEmail: async () => null,
      getName: async () => null,
      findActorRole: async () => null,
    },
    responsibleManagers: {
      findForProperty: async () => [SCOPE.managerUserId],
      findForPortal: async () => [],
      findForPortalGroup: async () => [],
      isEligibleForProperty: async () => true,
    },
    inboxItemLookup: createInboxItemLookupAdapter(getDb(), {
      findPortalId: async () => null,
    }),
    clock: () => CLOCK.deliveredAt,
    logger: createMockLogger(),
    receipts: { insertReceipt: async () => undefined },
  }
  return { deps, jobs }
}

/** Review's fact for revision 1 (created) or 2 (the edit), consumed by Inbox. */
async function projectRevision(revision: AnsweredEditRevision): Promise<void> {
  const event = await fixtures.recordSourceEvent(revision)
  const handle = revision === 1 ? handleInboxReviewCreated : handleInboxReviewUpdated
  await handle(inboxDeps(), event)
}

/** One provider snapshot read of the owner reply; Inbox then consumes
 * whatever `review.reply.observed` fact the read committed. */
async function readReply(text: string, revision: AnsweredEditRevision, at: Date) {
  const store = createGoogleReplyObservationStore(getDb())
  const before = (await fixtures.outboxEvents('review.reply.observed')).length
  const result = await store.record({
    organizationId: SCOPE.organizationId,
    propertyId: SCOPE.propertyId,
    reviewId: SCOPE.reviewId,
    sourceEpoch: 0,
    materialReviewRevision: revision,
    readGeneration: await store.allocateReadGeneration(),
    observationKey: sha256Hex(`answered-edit:${revision}:${text}`),
    source: 'provider_snapshot',
    observedText: text,
    providerUpdatedAt: CLOCK.revisionObservedAt(1),
    observedAt: at,
    contentExpiresAt: CLOCK.contentExpiresAt,
  })
  const facts = await fixtures.outboxEvents('review.reply.observed')
  for (const fact of facts.slice(before))
    await handleInboxReplyObserved(inboxDeps(), fact)
  return result
}

/** Feed's arrival fan-out from Inbox's committed `inbox.inbox_item.created`. */
async function fanOutArrival(): Promise<ReadonlyArray<InsertNotificationJobData>> {
  const [created] = await fixtures.outboxEvents('inbox.inbox_item.created')
  const feed = feedDeps()
  await handleNotificationInboxItemCreated(feed.deps, created!)
  return feed.jobs as InsertNotificationJobData[]
}

const notAskedForAnArrival = async (): Promise<never> => {
  throw new Error('an arrival asks only the Inbox whether it still waits')
}

/**
 * The insert-notification jobs, run later on the default queue, asking the
 * real Inbox through the work-state gate whether the review still waits.
 * Returns the notices written.
 */
async function writeNotices(jobs: ReadonlyArray<InsertNotificationJobData>) {
  const insert = buildFakeInsertNotificationDeps()
  // The manager follows arrivals in the app. They are off by default (ADR 0046,
  // amended 2026-09-30), and a notice nobody asked for would make the two
  // "writes nothing" cases below pass without the answered-first rule.
  vi.mocked(insert.preferenceRepo.resolveForDelivery).mockImplementation(
    async (_userId, _orgId, _propertyId, category, channel) =>
      resolveCategoryPreference({
        category,
        channel,
        property:
          category === 'arrivals' && channel === 'in_app'
            ? { enabled: true, cadence: 'daily' }
            : null,
        personalDefault: null,
      }),
  )
  const handle = createInsertNotificationHandler({
    ...insert,
    authorizeAudience: async () => true,
    workState: createNotificationWorkState({
      inboxItemLookup: feedDeps().deps.inboxItemLookup,
      escalationResolutions: { findEscalationResolutionFacts: notAskedForAnArrival },
      replyStates: { findReplyStatus: notAskedForAnArrival },
      portalHealthLookup: { findPortalHealthNotificationFacts: notAskedForAnArrival },
      organizationState: notAskedForAnArrival,
      responsibleManagers: {
        findForProperty: notAskedForAnArrival,
        findForPortal: notAskedForAnArrival,
      },
    }),
  })
  for (const data of jobs) await handle({ data } as Job<InsertNotificationJobData>)
  return vi.mocked(insert.notificationRepo.insert).mock.calls.map(([notice]) => notice)
}

/** Answered at revision 1, then edited by the guest with the reply still live. */
async function answerThenGuestEdits(): Promise<void> {
  await readReply(OLD_REPLY, 1, CLOCK.hoursAfter(1, 1))
  await fixtures.recordGuestEdit()
  await projectRevision(2)
  await readReply(OLD_REPLY, 2, CLOCK.hoursAfter(2, 1))
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 4)
  fixtures = answeredEditFixtures(lease.pool)
  clearEventSchemas()
  registerAllEventSchemas()
})

beforeEach(async () => {
  await fixtures.clean()
  await fixtures.seedReview()
  await projectRevision(1)
})

afterAll(async () => {
  await fixtures.clean()
  clearEventSchemas()
  await lease.release()
})

describe.sequential('a guest edit of an answered Google review (real PostgreSQL)', () => {
  it('reopens the item and keeps it open while only the old reply is live', async () => {
    await readReply(OLD_REPLY, 1, CLOCK.hoursAfter(1, 1))
    expect(await fixtures.inboxState()).toEqual({
      itemStatus: 'closed',
      cycleStatus: 'closed',
      cycleNumber: 1,
      sourceRevision: 1,
    })

    await fixtures.recordGuestEdit()
    await projectRevision(2)
    const reopens = await fixtures.outboxEvents('inbox.handling_cycle.reopened')
    expect(reopens.map((event) => event.payload)).toEqual([
      expect.objectContaining({
        cycleNumber: 2,
        sourceRevision: 2,
        reopenReason: 'material_revision_changed',
        actorType: 'provider',
        userId: null,
      }),
    ])

    // The sync right after the edit reads the old reply, still live.
    await expect(readReply(OLD_REPLY, 2, CLOCK.hoursAfter(2, 1))).resolves.toMatchObject({
      change: 'unchanged',
      resolution: 'unchanged',
    })
    expect(await fixtures.outboxEvents('review.reply.observed')).toHaveLength(1)
    expect(await fixtures.inboxState()).toEqual({
      itemStatus: 'open',
      cycleStatus: 'open',
      cycleNumber: 2,
      sourceRevision: 2,
    })
  })

  it('tells the responsible manager urgently, then settles on the reply to the edit', async () => {
    await answerThenGuestEdits()
    const [reopened] = await fixtures.outboxEvents('inbox.handling_cycle.reopened')

    const feed = feedDeps()
    await expect(handleNotificationHandlingCycle(feed.deps, reopened!)).resolves.toEqual({
      status: 'applied',
    })
    expect(feed.jobs).toEqual([
      expect.objectContaining({
        userId: SCOPE.managerUserId,
        type: 'inbox.reopened',
        resourceId: SCOPE.itemId,
        payload: expect.objectContaining({ reopenReason: 'material_revision_changed' }),
        audience: expect.objectContaining({
          kind: 'handling_cycle',
          cycleNumber: 2,
          sourceRevision: 2,
          actorUserId: null,
        }),
      }),
    ])

    // The owner answers the edit: that reply closes the reopened cycle, and
    // `inbox.handling_cycle.closed` is the fact that settles `inbox.reopened`.
    await expect(readReply(NEW_REPLY, 2, CLOCK.hoursAfter(2, 2))).resolves.toMatchObject({
      change: 'edited',
      resolution: 'external_current_live',
    })
    expect(await fixtures.inboxState()).toEqual({
      itemStatus: 'closed',
      cycleStatus: 'closed',
      cycleNumber: 2,
      sourceRevision: 2,
    })
    const closes = await fixtures.outboxEvents('inbox.handling_cycle.closed')
    expect(closes.at(-1)?.payload).toMatchObject({
      cycleNumber: 2,
      closeReason: 'external_reply_observed',
    })
    // A redelivered reopen can no longer reach anyone.
    const late = feedDeps()
    await expect(handleNotificationHandlingCycle(late.deps, reopened!)).resolves.toEqual({
      status: 'obsolete',
    })
    expect(late.jobs).toEqual([])
  })

  it('still opens, without a reopen, an unanswered review the guest edits', async () => {
    await fixtures.recordGuestEdit()
    await projectRevision(2)

    expect(await fixtures.outboxEvents('inbox.handling_cycle.reopened')).toEqual([])
    const revisionOpenings = (
      await fixtures.outboxEvents('inbox.handling_cycle.opened')
    ).filter((event) => event.payload.openReason === 'material_revision_changed')
    expect(revisionOpenings.map((event) => event.payload)).toEqual([
      expect.objectContaining({ cycleNumber: 2, openedWithItem: false }),
    ])
    expect(await fixtures.inboxState()).toMatchObject({
      cycleStatus: 'open',
      cycleNumber: 2,
    })
  })
})

// Before any reply, the same review's arrival. The fan-out and the insert job
// run seconds apart, and the insert asks the Inbox whether the review still
// waits (ADR 0046, amended 2026-09-28). An unanswered review is always
// announced; one the owner answered first is not, whichever side of the
// fan-out the answer lands on, because `inbox.handling_cycle.closed` settles
// only rows that already exist and a late row would ask for a reply forever.
describe.sequential("a new Google review's arrival notice (real PostgreSQL)", () => {
  it('announces a new, unanswered review to the responsible manager', async () => {
    const notices = await writeNotices(await fanOutArrival())

    expect(notices).toEqual([
      expect.objectContaining({
        userId: SCOPE.managerUserId,
        type: 'review.created',
        resourceId: SCOPE.itemId,
      }),
    ])
  })

  it('writes nothing when the owner answered while its insert job was queued', async () => {
    const jobs = await fanOutArrival()
    expect(jobs).toHaveLength(1)
    await readReply(OLD_REPLY, 1, CLOCK.hoursAfter(1, 1))

    await expect(writeNotices(jobs)).resolves.toEqual([])
  })

  it('writes nothing when the owner answered before the fan-out ran', async () => {
    await readReply(OLD_REPLY, 1, CLOCK.hoursAfter(1, 1))
    expect(await fixtures.inboxState()).toMatchObject({ cycleStatus: 'closed' })

    await expect(writeNotices(await fanOutArrival())).resolves.toEqual([])
  })
})
