// A grouped reopen mailed hours after it was written (N15).
//
// The insert job recounted the items that still stood; the send never did.
// A manager whose "5 items reopened" email waited for quiet hours to end was
// told about five items after all five were handled, or five after two.

import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { NotificationWorkDecision } from '../../application/notification-work-state'
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
const NOW = new Date('2026-01-15T15:00:00.000Z')

const grouped = buildNotification({
  propertyId: PROPERTY as string,
  type: 'inbox.bulk_reopened',
  category: 'urgent_operational',
  resourceType: 'inbox_item',
  resourceId: 'item-1',
  payload: { propertyName: 'Riverside Hotel', itemCount: 5 },
})
const workState = (answer: NotificationWorkDecision) => ({
  isWaiting: vi.fn(async () => answer),
  finished: vi.fn(),
})

describe('the immediate email of a grouped reopen', () => {
  const entry = buildNotificationEmail({
    propertyId: PROPERTY as string,
    cadence: 'immediate',
  })
  const deps = (answer: NotificationWorkDecision) => ({
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
    workState: workState(answer),
    logger: createFakeJobLogger(),
    clock: () => NOW,
    baseUrl: 'https://app.example.com',
    oneClickUnsubscribeUrl: () => 'https://app.example.com/unsubscribe',
  })
  const run = (built: ReturnType<typeof deps>) =>
    createUrgentEmailJobHandler(
      built as unknown as Parameters<typeof createUrgentEmailJobHandler>[0],
    )({
      data: {
        notificationEmailId: entry.id as string,
        organizationId: ORG as string,
        propertyId: PROPERTY as string,
      } as unknown as UrgentEmailJobData,
    })

  it('says how many items still wait when it is sent', async () => {
    const built = deps({ itemCount: 2 })

    await run(built)

    expect(built.emailSender.send.mock.calls[0]![0].subject).toContain('2 items reopened')
  })

  it('is retired once none of them does', async () => {
    const built = deps(false)

    await run(built)

    expect(built.emailSender.send).not.toHaveBeenCalled()
  })
})

describe('the digest line of a grouped reopen', () => {
  it('says how many items still wait', async () => {
    const entry = buildNotificationEmail({ propertyId: PROPERTY as string })
    const deps = {
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
      workState: workState({ itemCount: 3 }),
    } as unknown as DigestEntryDeps
    const ctx = {
      orgId: ORG,
      userId: userId('user-1'),
      rawOrgId: ORG as string,
      now: NOW,
      timezone: 'UTC',
      timezoneSource: 'fallback',
      quietHours: { quietHoursStart: null, quietHoursEnd: null },
    } as unknown as RecipientContext

    const [item] = await loadItems(deps, ctx, [entry])

    expect(item!.notification.payload).toMatchObject({ itemCount: 3 })
  })
})
