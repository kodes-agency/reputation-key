// Shared test fixtures for notification event-handler tests.
// Eliminates repeated queue/userLookup/logger fake construction across handlers.

import { vi, expect, type Mock } from 'vitest'
import type { Queue } from 'bullmq'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { NotificationType } from '../../domain/types'
import {
  organizationId,
  propertyId,
  reviewId,
  replyId,
  inboxItemId,
  inboxNoteId,
  userId,
  type UserId,
} from '#/shared/domain/ids'
import type {
  InboxItemCreated,
  InboxItemEscalated,
  InboxNoteAdded,
} from '#/contexts/inbox/application/public-api'
import type {
  ReviewCreated,
  ReviewReplyApproved,
  ReviewReplyPublished,
  ReviewReplyPublishFailed,
  ReviewReplyRejected,
  ReviewReplySubmitted,
} from '#/contexts/review/application/public-api'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

export type FakeJob = Readonly<{ name: string; data: unknown; opts?: unknown }>

/** Maps every method of a port to a vitest Mock, exposing `.mockResolvedValue(...)` etc. */
type MockedPort<T> = Readonly<{ [K in keyof T]: Mock }>

/** Deps shape consumed by every notification event-handler test. */
export type FakeEventHandlerDeps = Readonly<{
  queue: Queue
  addMock: Mock
  jobs: FakeJob[]
  userLookup: MockedPort<UserLookupPort>
  logger: MockedPort<LoggerPort>
}>

/** In-memory fake BullMQ queue that records every `add()` as a job. */
const createFakeQueue = (): Pick<FakeEventHandlerDeps, 'queue' | 'addMock' | 'jobs'> => {
  const jobs: FakeJob[] = []
  const addMock = vi.fn(async (name: string, data: unknown, opts?: unknown) => {
    jobs.push({ name, data, opts })
  })
  return { queue: { add: addMock } as unknown as Queue, addMock, jobs }
}

/** Fake UserLookupPort — every method starts as an empty/mockable vi.fn(). */
const createFakeUserLookup = (): MockedPort<UserLookupPort> =>
  ({
    findAssignedManagers: vi.fn(async () => []),
    findByRole: vi.fn(async () => []),
    getEmail: vi.fn(async () => null),
    getName: vi.fn(async () => null),
  }) as unknown as MockedPort<UserLookupPort>

/** Fake LoggerPort. */
const createFakeLogger = (): MockedPort<LoggerPort> =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as unknown as MockedPort<LoggerPort>

/** Build the full deps record used by notification event-handler tests. */
export const createEventHandlerDeps = (): FakeEventHandlerDeps => ({
  ...createFakeQueue(),
  userLookup: createFakeUserLookup(),
  logger: createFakeLogger(),
})

// ── Shared id constants ──────────────────────────────────────────────
// Every notification event-handler test uses the same org/property/review/etc.
// identifiers; centralising them removes a large block of per-file scaffolding.
export const NOTIF_TEST_IDS = {
  orgId: organizationId('org-1'),
  propId: propertyId('prop-1'),
  reviewId: reviewId('rev-1'),
  replyId: replyId('reply-1'),
  inboxItemId: inboxItemId('item-1'),
  noteId: inboxNoteId('note-1'),
  authorId: userId('author-1'),
  manager1: userId('mgr-1'),
  manager2: userId('mgr-2'),
  admin1: userId('admin-1'),
  admin2: userId('admin-2'),
  submitter: userId('user-1'),
  now: new Date('2026-06-01T12:00:00Z'),
  eventId: 'test-event-id',
} as const

// ── Event builders (one per consumed event shape) ────────────────────
// Each returns a fully-typed event with the standard test fields, accepting
// overrides so individual tests can vary a single field.

export const buildInboxItemCreatedEvent = (
  overrides: Partial<InboxItemCreated> = {},
): InboxItemCreated => ({
  _tag: 'inbox.inbox_item.created',
  eventId: NOTIF_TEST_IDS.eventId,
  correlationId: null,
  inboxItemId: NOTIF_TEST_IDS.inboxItemId,
  organizationId: NOTIF_TEST_IDS.orgId,
  propertyId: NOTIF_TEST_IDS.propId,
  sourceType: 'feedback',
  sourceId: NOTIF_TEST_IDS.reviewId,
  userId: null,
  source: 'web',
  occurredAt: NOTIF_TEST_IDS.now,
  ...overrides,
})

export const buildInboxNoteAddedEvent = (
  overrides: Partial<InboxNoteAdded> = {},
): InboxNoteAdded => ({
  _tag: 'inbox.inbox_note.added',
  eventId: NOTIF_TEST_IDS.eventId,
  correlationId: null,
  inboxItemId: NOTIF_TEST_IDS.inboxItemId,
  organizationId: NOTIF_TEST_IDS.orgId,
  propertyId: NOTIF_TEST_IDS.propId,
  userId: NOTIF_TEST_IDS.authorId,
  noteId: NOTIF_TEST_IDS.noteId,
  text: 'Some note text',
  source: 'web',
  occurredAt: NOTIF_TEST_IDS.now,
  ...overrides,
})

export const buildReviewCreatedEvent = (
  overrides: Partial<ReviewCreated> = {},
): ReviewCreated => ({
  _tag: 'review.created',
  eventId: NOTIF_TEST_IDS.eventId,
  correlationId: null,
  reviewId: NOTIF_TEST_IDS.reviewId,
  propertyId: NOTIF_TEST_IDS.propId,
  organizationId: NOTIF_TEST_IDS.orgId,
  platform: 'google',
  externalId: 'ext-1',
  rating: 4,
  reviewText: 'Nice hotel',
  reviewerName: null,
  occurredAt: NOTIF_TEST_IDS.now,
  ...overrides,
})

export const buildInboxItemEscalatedEvent = (
  overrides: Partial<InboxItemEscalated> = {},
): InboxItemEscalated => ({
  _tag: 'inbox.inbox_item.escalated',
  eventId: NOTIF_TEST_IDS.eventId,
  correlationId: null,
  inboxItemId: NOTIF_TEST_IDS.inboxItemId,
  organizationId: NOTIF_TEST_IDS.orgId,
  propertyId: NOTIF_TEST_IDS.propId,
  userId: NOTIF_TEST_IDS.submitter,
  oldStatus: 'new',
  source: 'web',
  occurredAt: NOTIF_TEST_IDS.now,
  ...overrides,
})

export const buildReplySubmittedEvent = (
  overrides: Partial<ReviewReplySubmitted> = {},
): ReviewReplySubmitted => ({
  _tag: 'review.reply.submitted',
  eventId: NOTIF_TEST_IDS.eventId,
  correlationId: null,
  replyId: NOTIF_TEST_IDS.replyId,
  reviewId: NOTIF_TEST_IDS.reviewId,
  propertyId: NOTIF_TEST_IDS.propId,
  organizationId: NOTIF_TEST_IDS.orgId,
  userId: NOTIF_TEST_IDS.submitter,
  source: 'web',
  occurredAt: NOTIF_TEST_IDS.now,
  ...overrides,
})

export const buildReplyApprovedEvent = (
  overrides: Partial<ReviewReplyApproved> = {},
): ReviewReplyApproved => ({
  _tag: 'review.reply.approved',
  eventId: NOTIF_TEST_IDS.eventId,
  correlationId: null,
  replyId: NOTIF_TEST_IDS.replyId,
  reviewId: NOTIF_TEST_IDS.reviewId,
  propertyId: NOTIF_TEST_IDS.propId,
  organizationId: NOTIF_TEST_IDS.orgId,
  userId: userId('approver-1'),
  authorId: NOTIF_TEST_IDS.authorId,
  source: 'web',
  occurredAt: NOTIF_TEST_IDS.now,
  ...overrides,
})

export const buildReplyPublishedEvent = (
  overrides: Partial<ReviewReplyPublished> = {},
): ReviewReplyPublished => ({
  _tag: 'review.reply.published',
  eventId: NOTIF_TEST_IDS.eventId,
  correlationId: null,
  replyId: NOTIF_TEST_IDS.replyId,
  reviewId: NOTIF_TEST_IDS.reviewId,
  propertyId: NOTIF_TEST_IDS.propId,
  organizationId: NOTIF_TEST_IDS.orgId,
  userId: userId('publisher-1'),
  authorId: NOTIF_TEST_IDS.authorId,
  source: 'web',
  occurredAt: NOTIF_TEST_IDS.now,
  ...overrides,
})

export const buildReplyPublishFailedEvent = (
  overrides: Partial<ReviewReplyPublishFailed> = {},
): ReviewReplyPublishFailed => ({
  _tag: 'review.reply.publish_failed',
  eventId: NOTIF_TEST_IDS.eventId,
  correlationId: null,
  replyId: NOTIF_TEST_IDS.replyId,
  reviewId: NOTIF_TEST_IDS.reviewId,
  propertyId: NOTIF_TEST_IDS.propId,
  organizationId: NOTIF_TEST_IDS.orgId,
  authorId: NOTIF_TEST_IDS.authorId,
  occurredAt: NOTIF_TEST_IDS.now,
  ...overrides,
})

export const buildReplyRejectedEvent = (
  overrides: Partial<ReviewReplyRejected> = {},
): ReviewReplyRejected => ({
  _tag: 'review.reply.rejected',
  eventId: NOTIF_TEST_IDS.eventId,
  correlationId: null,
  replyId: NOTIF_TEST_IDS.replyId,
  reviewId: NOTIF_TEST_IDS.reviewId,
  propertyId: NOTIF_TEST_IDS.propId,
  organizationId: NOTIF_TEST_IDS.orgId,
  userId: userId('rejector-1'),
  authorId: NOTIF_TEST_IDS.authorId,
  reason: 'Tone too aggressive',
  source: 'web',
  occurredAt: NOTIF_TEST_IDS.now,
  ...overrides,
})

// ── Expected insert-notification job helper ──────────────────────────
// Builds the { name, data } object every event handler enqueues, filling in
// the invariant fields (job name, org id, event id) so call sites only spell
// out the values that are meaningful to each test.

type ExpectedNotificationJobData = {
  userId: UserId
  type: NotificationType
  resourceType: 'inbox_item' | 'reply'
  resourceId: string
  title: string
  body: string
}

export const buildExpectedJob = (data: ExpectedNotificationJobData) => ({
  name: INSERT_NOTIFICATION_JOB_NAME,
  data: {
    ...data,
    organizationId: NOTIF_TEST_IDS.orgId,
    eventId: NOTIF_TEST_IDS.eventId,
  },
})

// ── Shared event-handler assertions / stubs ─────────────────────────

/** Assert the handler enqueued exactly `count` notification jobs. */
export const expectJobsEnqueued = (deps: FakeEventHandlerDeps, count: number): void => {
  expect(deps.queue.add).toHaveBeenCalledTimes(count)
  expect(deps.jobs).toHaveLength(count)
}

/** Stub a single manager + a rejecting queue, for "propagates error from queue.add" tests. */
export const stubManagerForQueueAddError = (deps: FakeEventHandlerDeps): void => {
  deps.userLookup.findAssignedManagers.mockResolvedValue([NOTIF_TEST_IDS.manager1])
  deps.addMock.mockRejectedValue(new Error('Queue unavailable'))
}
