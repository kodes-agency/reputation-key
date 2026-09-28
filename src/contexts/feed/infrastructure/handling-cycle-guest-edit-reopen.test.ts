import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { clearEventSchemas, validateEventPayload } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { inboxItemId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import {
  handleNotificationHandlingCycle,
  ON_INBOX_HANDLING_CYCLE_REOPENED_CONSUMER,
} from './handling-cycle-outbox-consumers'
import { classifyNotification } from '../domain/notification-delivery-policy'
import { parseNotificationPayload } from '../domain/notification-payload'
import { renderNotification } from '../domain/notification-templates'
import { settledNotificationTypes } from '../domain/notification-settlement'
import type { HandlingCycleNotificationFacts } from '../application/ports/notification-inbox-item-lookup.port'

// ADR 0046: a guest edit that reopens CLOSED work is `inbox.reopened` and stays
// `urgent_operational` — somebody had considered the item finished. Inbox
// records it as `inbox.handling_cycle.reopened` with the closed revision cause
// `material_revision_changed`; the provider, not a person, reopened it.

const EVENT_ID = '93100000-0000-4000-8000-000000000001'
const ITEM = inboxItemId('93100000-0000-4000-8000-000000000002')
const PROPERTY = propertyId('93100000-0000-4000-8000-000000000003')
const SOURCE = '93100000-0000-4000-8000-000000000004'
const ORG = organizationId('organization-guest-edit-reopen')
const MANAGER = userId('manager-guest-edit-reopen')
const OWNER = userId('owner-guest-edit-reopen')
const OCCURRED_AT = '2026-09-28T10:00:00.000Z'

const guestEditReopen = (): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'inbox.handling_cycle.reopened',
  eventVersion: 1,
  payload: {
    inboxItemId: ITEM,
    cycleNumber: 2,
    stateRevision: 3,
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceType: 'review',
    sourceId: SOURCE,
    sourceRevision: 2,
    actorType: 'provider',
    userId: null,
    triggerEventId: null,
    reopenReason: 'material_revision_changed',
    bulkId: null,
    source: 'import',
    occurredAt: OCCURRED_AT,
  },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'inbox',
  sourceAggregateId: ITEM,
  occurredAt: OCCURRED_AT,
  recordedAt: OCCURRED_AT,
})

const openHead: HandlingCycleNotificationFacts = {
  propertyId: PROPERTY,
  portalId: null,
  assignedTo: null,
  propertyName: 'Riverside Hotel',
  guestRating: null,
  sourceType: 'review',
  sourceId: SOURCE,
  createdAt: new Date('2026-09-20T08:00:00.000Z'),
  currentCycleNumber: 2,
  currentSourceRevision: 2,
  stateRevision: 3,
  status: 'open',
}

const makeDeps = (head: HandlingCycleNotificationFacts) => {
  const jobs: Array<{ name: string; data: Record<string, unknown>; opts?: unknown }> = []
  return {
    queue: {
      add: vi.fn(async (name: string, data: Record<string, unknown>, opts?: unknown) => {
        jobs.push({ name, data, opts })
      }),
    },
    userLookup: {
      findByRole: vi.fn(async () => []),
      getEmail: vi.fn(async () => null),
      getName: vi.fn(async () => null),
      findActorRole: vi.fn(async () => null),
    },
    responsibleManagers: {
      findForProperty: vi.fn(async () => [MANAGER, OWNER]),
      findForPortal: vi.fn(async () => []),
      findForPortalGroup: vi.fn(async () => []),
      isEligibleForProperty: vi.fn(async () => true),
    },
    inboxItemLookup: {
      findInboxItemByReviewId: vi.fn(async () => ITEM),
      findInboxItemFacts: vi.fn(async () => head),
      isHistoricalOnboardingItem: vi.fn(async () => false),
      findHandlingCycleNotificationFacts: vi.fn(async () => head),
      findResponseTargetReminderNotificationFacts: vi.fn(async () => null),
      findWaitingSince: vi.fn(async (): Promise<Date | null> => null),
      findNoteAuthors: vi.fn(async () => []),
      countOpenReviewItemsForProperty: vi.fn(async () => 0),
      hasPendingReviewProjections: vi.fn(async () => false),
    },
    clock: () => new Date('2026-09-28T10:01:00.000Z'),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    receipts: { insertReceipt: vi.fn(async () => undefined) },
    jobs,
  }
}

describe('a guest edit that reopens an answered review', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => clearEventSchemas())

  it('is an admissible reopen fact under the non-strict outbox schema', () => {
    const event = guestEditReopen()
    expect(
      validateEventPayload(event.eventType, event.eventVersion, event.payload),
    ).toMatchObject({ reopenReason: 'material_revision_changed', userId: null })
  })

  it('tells every responsible manager, urgently, about the exact reopened cycle', async () => {
    const deps = makeDeps(openHead)

    await expect(
      handleNotificationHandlingCycle(deps, guestEditReopen()),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.jobs.map((job) => job.data.userId)).toEqual([MANAGER, OWNER])
    for (const job of deps.jobs) {
      expect(job.data).toMatchObject({
        type: 'inbox.reopened',
        resourceType: 'inbox_item',
        resourceId: ITEM,
        payload: {
          propertyName: 'Riverside Hotel',
          reopenReason: 'material_revision_changed',
        },
        audience: {
          kind: 'handling_cycle',
          inboxItemId: ITEM,
          cycleNumber: 2,
          sourceRevision: 2,
          stateRevision: 3,
          actorUserId: null,
        },
      })
    }
    expect(classifyNotification('inbox.reopened')).toBe('urgent_operational')
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_INBOX_HANDLING_CYCLE_REOPENED_CONSUMER,
      'applied',
    )
  })

  it('says the guest changed the review, and keeps that cause in the stored payload', () => {
    const payload = parseNotificationPayload({
      propertyName: 'Riverside Hotel',
      platform: 'google',
      reopenReason: 'material_revision_changed',
    })

    expect(payload.reopenReason).toBe('material_revision_changed')
    expect(renderNotification('inbox.reopened', payload)).toMatchObject({
      title: 'Reopened: review at Riverside Hotel',
      body: 'The guest changed their review after it was handled. Open it to see where it stands.',
    })
  })

  it('is settled by the reply that answers the new revision closing the cycle', async () => {
    expect(settledNotificationTypes('handling_cycle.closed')).toContain('inbox.reopened')

    const deps = makeDeps({ ...openHead, stateRevision: 4, status: 'closed' })
    await expect(
      handleNotificationHandlingCycle(deps, guestEditReopen()),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(deps.jobs).toEqual([])
  })
})
