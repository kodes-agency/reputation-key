// A grouped assignment mailed after part of it moved on.
//
// The audience check counts the items still assigned to the recipient and the
// work check counted the items still open, so a recipient who kept six of ten
// open items was mailed "10 items assigned to you" once four of them went to a
// colleague. The send restates the count (Feed CONTEXT, Runtime): it is the
// items that are still the recipient's and still open.

import { describe, expect, it, vi } from 'vitest'
import { inboxItemId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { HandlingCycleNotificationFacts } from '../../application/ports/notification-inbox-item-lookup.port'
import { createNotificationWorkState } from '../../application/notification-work-state'
import { createUrgentEmailJobHandler, type UrgentEmailJobData } from './urgent-email.job'
import {
  loadItems,
  type DigestEntryDeps,
  type RecipientContext,
} from './digest-entry-selection'
import {
  buildNotification,
  buildNotificationEmail,
  createFakeJobLogger,
} from './test-fixtures'

const ORG = organizationId('org-1')
const PROPERTY = propertyId('11111111-1111-4111-8111-111111111111')
const RECIPIENT = userId('user-1')
const COLLEAGUE = userId('user-2')
const NOW = new Date('2026-01-15T15:00:00.000Z')

const ITEM_IDS = Array.from({ length: 10 }, (_unused, index) => `item-${index + 1}`)

/** Ten open items; the recipient still holds the first six, a colleague the rest. */
const itemFacts = (item: string): HandlingCycleNotificationFacts => ({
  propertyId: PROPERTY as string,
  portalId: null,
  assignedTo: ITEM_IDS.indexOf(item) < 6 ? RECIPIENT : COLLEAGUE,
  propertyName: 'Riverside Hotel',
  guestRating: null,
  sourceType: 'review',
  sourceId: `review-${item}`,
  createdAt: new Date('2026-01-14T00:00:00.000Z'),
  currentCycleNumber: 1,
  currentSourceRevision: 1,
  stateRevision: 1,
  status: 'open',
})

const workState = () =>
  createNotificationWorkState({
    inboxItemLookup: {
      findHandlingCycleNotificationFacts: vi.fn(
        async (item: ReturnType<typeof inboxItemId>) => itemFacts(item as string),
      ),
    },
  } as never)

const audience = { kind: 'bulk_inbox_assignee', inboxItemIds: ITEM_IDS }

const grouped = buildNotification({
  userId: RECIPIENT as string,
  propertyId: PROPERTY as string,
  type: 'inbox.bulk_assigned',
  category: 'workflow_collaboration',
  resourceType: 'inbox_item',
  resourceId: 'item-1',
  payload: { propertyName: 'Riverside Hotel', itemCount: 10 },
})

const entry = buildNotificationEmail({
  userId: RECIPIENT as string,
  propertyId: PROPERTY as string,
  category: 'workflow_collaboration',
  cadence: 'immediate',
  recipientAudience: audience,
})

describe('the immediate email of a grouped assignment', () => {
  const deps = () => ({
    emailRepo: {
      findById: vi.fn(async () => entry),
      markSuppressed: vi.fn(async () => {}),
      markAttemptStarted: vi.fn(async () => {}),
      markAccepted: vi.fn(async () => {}),
      recordEmailUnsubscribeScope: vi.fn(async () => {}),
      isAddressSuppressed: vi.fn(async () => false),
    },
    preferenceRepo: {
      resolveForDelivery: vi.fn(async () => ({ enabled: true, cadence: 'immediate' })),
      resolveDeliveryWindow: vi.fn(async () => ({
        quietHoursStart: null,
        quietHoursEnd: null,
        urgentBypassEnabled: false,
      })),
      getUserSettings: vi.fn(async () => null),
    },
    notifRepo: { findByIdForProperty: vi.fn(async () => grouped) },
    userLookup: { getEmail: vi.fn(async () => 'manager@example.com') },
    emailSender: {
      send: vi.fn(async (_request: { subject: string; text: string }) => ({
        kind: 'accepted' as const,
        providerMessageId: 'provider-1',
        acceptedAt: NOW,
      })),
    },
    resolvePropertyScope: vi.fn(async () => ({
      organizationId: ORG as string,
      propertyId: PROPERTY as string,
      timezone: 'Europe/London',
    })),
    resolveOrganizationScope: vi.fn(async () => ({ timezone: 'Europe/London' })),
    authorizeScope: vi.fn(async () => true),
    organizationEmailStop: vi.fn(async () => 'none' as const),
    isRecipientEligible: vi.fn(async () => true),
    workState: workState(),
    logger: createFakeJobLogger(),
    clock: () => NOW,
    baseUrl: 'https://app.example.com',
    oneClickUnsubscribeUrl: () => 'https://app.example.com/unsubscribe',
  })

  it('counts only the items still assigned to the recipient', async () => {
    const built = deps()

    await createUrgentEmailJobHandler(
      built as unknown as Parameters<typeof createUrgentEmailJobHandler>[0],
    )({
      data: {
        notificationEmailId: entry.id as string,
        organizationId: ORG as string,
        propertyId: PROPERTY as string,
      } as unknown as UrgentEmailJobData,
    })

    expect(built.emailSender.send.mock.calls[0]![0].subject).toContain(
      '6 items assigned to you',
    )
  })
})

describe('the digest line of a grouped assignment', () => {
  it('counts only the items still assigned to the recipient', async () => {
    const digestDeps = {
      emailRepo: { markSuppressed: vi.fn(async () => {}), markDelayed: vi.fn() },
      preferenceRepo: { resolveForDelivery: vi.fn() },
      notifRepo: {
        findByIdsForProperty: vi.fn(
          async () => new Map([[grouped.id as string, grouped]]),
        ),
      },
      logger: createFakeJobLogger(),
      resolvePropertyScope: vi.fn(),
      authorizeScope: vi.fn(),
      isRecipientEligible: vi.fn(),
      workState: workState(),
    } as unknown as DigestEntryDeps
    const ctx = {
      orgId: ORG,
      userId: RECIPIENT,
      rawOrgId: ORG as string,
      now: NOW,
      timezone: 'UTC',
      timezoneSource: 'fallback',
      quietHours: { quietHoursStart: null, quietHoursEnd: null },
    } as unknown as RecipientContext

    const [item] = await loadItems(digestDeps, ctx, [entry])

    expect(item!.notification.payload).toMatchObject({ itemCount: 6 })
  })
})
