// Shared fakes for notification durable-consumer tests.

import { vi, type Mock } from 'vitest'
import type { Queue } from 'bullmq'
import type { UserLookupPort } from '../application/ports/user-lookup.port'
import type { InboxItemLookupPort } from '../application/ports/inbox-item-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import {
  organizationId,
  propertyId,
  reviewId,
  replyId,
  inboxItemId,
  inboxNoteId,
  userId,
} from '#/shared/domain/ids'

export type FakeJob = Readonly<{ name: string; data: unknown; opts?: unknown }>

type MockedPort<T> = Readonly<{ [K in keyof T]: Mock }>

export type FakeNotificationConsumerDeps = Readonly<{
  queue: Queue
  addMock: Mock
  jobs: FakeJob[]
  userLookup: MockedPort<UserLookupPort>
  responsibleManagers: MockedPort<ResponsibleManagerLookupPort>
  inboxItemLookup: MockedPort<InboxItemLookupPort>
  clock: () => Date
  logger: MockedPort<LoggerPort>
}>

const createFakeQueue = (): Pick<
  FakeNotificationConsumerDeps,
  'queue' | 'addMock' | 'jobs'
> => {
  const jobs: FakeJob[] = []
  const addMock = vi.fn(async (name: string, data: unknown, opts?: unknown) => {
    jobs.push(opts === undefined ? { name, data } : { name, data, opts })
  })
  return { queue: { add: addMock } as unknown as Queue, addMock, jobs }
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
  } as unknown as MockedPort<InboxItemLookupPort>

  return {
    ...createFakeQueue(),
    userLookup,
    responsibleManagers,
    logger,
    inboxItemLookup,
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
