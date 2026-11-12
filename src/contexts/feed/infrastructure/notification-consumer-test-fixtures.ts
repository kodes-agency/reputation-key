// Shared fakes for notification durable-consumer tests.

import { vi, type Mock } from 'vitest'
import type { Queue } from 'bullmq'
import type { Notice, NoticeWriter } from '../notify/consumers.server'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { InboxItemLookupPort } from '../application/ports/notification-inbox-item-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type {
  ReplyApprovalAuthorityPort,
  DisplayNameLookupPort,
} from '../application/ports/cross-context-lookups.port'
import {
  organizationId,
  propertyId,
  reviewId,
  replyId,
  inboxItemId,
  inboxNoteId,
  userId,
} from '#/shared/domain/ids'

/** What the fake writer records for each notice: the notice with its source event. */
export type QueuedNotice = Notice & Readonly<{ eventId: string }>

export type FakeJob = Readonly<{ name: string; data: unknown; opts?: unknown }>

type MockedPort<T> = Readonly<{ [K in keyof T]: Mock }>

export type FakeNotificationConsumerDeps = Readonly<{
  queue: Queue
  addMock: Mock
  jobs: FakeJob[]
  /** Records each notice it is given as a job on `jobs`, and its receipt on `receipts`. */
  noticeWriter: NoticeWriter
  receipts: Readonly<{ insertReceipt: Mock }>
  userLookup: MockedPort<UserLookupPort>
  responsibleManagers: MockedPort<ResponsibleManagerLookupPort>
  replyApproval: MockedPort<ReplyApprovalAuthorityPort>
  inboxItemLookup: MockedPort<InboxItemLookupPort>
  displayNames: MockedPort<DisplayNameLookupPort>
  /** Whether the Property is still active; archived and later states are not. */
  activeProperty: Mock
  /** Retires the previous holder's "Assigned to you" once an item moves on. */
  retireMovedAssignment: Mock
  clock: () => Date
  logger: MockedPort<LoggerPort>
}>

/**
 * A writer that hands each notice to `queue.add` as the job a queued delivery
 * once was, then records the receipt, so a test reads what a consumer wrote
 * from the queue and receipt mocks it already holds.
 */
export const noticeWriterOver = (
  queue: Readonly<{
    add(name: string, data: unknown, opts?: unknown): Promise<unknown>
  }>,
  receipts: Readonly<{
    insertReceipt(eventId: string, consumerName: string, status: string): Promise<unknown>
  }>,
): NoticeWriter => ({
  write: async ({ eventId, consumerName, status, notices }) => {
    for (const notice of notices) {
      await queue.add(
        'insert-notification',
        { ...notice, eventId },
        { jobId: `${eventId}-${notice.userId}` },
      )
    }
    await receipts.insertReceipt(eventId, consumerName, status)
    return status
  },
})

const createFakeQueue = (): Pick<
  FakeNotificationConsumerDeps,
  'queue' | 'addMock' | 'jobs' | 'noticeWriter' | 'receipts'
> => {
  const jobs: FakeJob[] = []
  const addMock = vi.fn(async (name: string, data: unknown, opts?: unknown) => {
    jobs.push(opts === undefined ? { name, data } : { name, data, opts })
  })
  const receipts = {
    insertReceipt: vi.fn(
      async (_eventId: string, _consumerName: string, _status: string) => {},
    ),
  }
  const noticeWriter = noticeWriterOver({ add: addMock }, receipts)
  return {
    queue: { add: addMock } as unknown as Queue,
    addMock,
    jobs,
    noticeWriter,
    receipts,
  }
}

export const createNotificationConsumerDeps = (): FakeNotificationConsumerDeps => {
  const userLookup = {
    findByRole: vi.fn(async () => []),
    getEmail: vi.fn(async () => null),
    getName: vi.fn(async () => null),
    findActorRole: vi.fn(async () => 'property_manager'),
  } as unknown as MockedPort<UserLookupPort>
  const responsibleManagers = {
    findForProperty: vi.fn(async () => []),
    findForPortal: vi.fn(async () => []),
    findForPortalGroup: vi.fn(async () => []),
    isEligibleForProperty: vi.fn(async () => false),
  } as unknown as MockedPort<ResponsibleManagerLookupPort>
  const replyApproval = {
    canApproveReplies: vi.fn(async () => true),
  } as unknown as MockedPort<ReplyApprovalAuthorityPort>
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as MockedPort<LoggerPort>
  const inboxItemLookup = {
    findInboxItemByReviewId: vi.fn(async () => inboxItemId('item-1')),
    findInboxItemFacts: vi.fn(async () => ({
      propertyId: 'prop-1',
      portalId: null,
      assignedTo: null,
      propertyName: 'Riverside Hotel',
      guestRating: null,
      sourceType: 'review',
      createdAt: new Date('2026-06-01T09:00:00.000Z'),
    })),
    isHistoricalOnboardingItem: vi.fn(async () => false),
    findHandlingCycleNotificationFacts: vi.fn(async () => ({
      propertyId: 'prop-1',
      portalId: null,
      assignedTo: null,
      propertyName: 'Riverside Hotel',
      guestRating: null,
      sourceType: 'review',
      sourceId: 'source-1',
      createdAt: new Date('2026-06-01T09:00:00.000Z'),
      currentCycleNumber: 1,
      currentSourceRevision: 1,
      stateRevision: 1,
      status: 'open',
    })),
    findResponseTargetReminderNotificationFacts: vi.fn(async () => null),
    findWaitingSince: vi.fn(async () => null),
    findNoteAuthors: vi.fn(async () => []),
    countOpenReviewItemsForProperty: vi.fn(async () => 0),
    hasPendingReviewProjections: vi.fn(async () => false),
  } as unknown as MockedPort<InboxItemLookupPort>

  const displayNames = {
    findPropertyName: vi.fn(async () => 'Riverside Hotel'),
    findOrganizationName: vi.fn(async () => null),
  } as unknown as MockedPort<DisplayNameLookupPort>

  return {
    ...createFakeQueue(),
    userLookup,
    responsibleManagers,
    replyApproval,
    logger,
    inboxItemLookup,
    displayNames,
    activeProperty: vi.fn(async () => true),
    retireMovedAssignment: vi.fn(async () => {}),
    clock: () => new Date('2026-06-01T12:00:00.000Z'),
  }
}

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
