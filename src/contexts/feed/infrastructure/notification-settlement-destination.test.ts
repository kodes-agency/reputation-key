// A site that was waiting for an account admin stops asking once it is decided
// (ADR 0046, amended 2026-10-26). Approved, turned off or held back for safety:
// whichever it was, nobody is left to decide it, so every admin's notice and
// the mail queued behind it go. A site that is waiting again keeps its notice.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { notificationId, propertyId, type NotificationId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  isStillActionable,
  SETTLED_EMAIL_REASON,
} from '../domain/notification-settlement'
import { handleNotificationSettlementEvent } from './notification-settlement-outbox-consumers'
import { noGroupedReopens, waitingWorkState } from './jobs/test-fixtures'

const ORG = 'organization-site-decided'
const PROPERTY = propertyId('99000000-0000-4000-8000-000000000001')
const SITE = '99000000-0000-4000-8000-000000000002'
const SETTLED = notificationId('99000000-0000-4000-8000-000000000005')
const NOW = new Date('2026-10-26T07:00:00.000Z')
const OCCURRED_AT = new Date('2026-10-26T06:30:00.000Z')

const makeDeps = () => ({
  notifications: {
    settleUnreadForProperty: vi.fn(
      async (): Promise<ReadonlyArray<NotificationId>> => [],
    ),
    settleUnreadForResource: vi.fn(async (): Promise<ReadonlyArray<NotificationId>> => [
      SETTLED,
    ]),
  },
  groupedReopens: noGroupedReopens(),
  emails: { cancelQueuedForNotifications: vi.fn(async () => 1) },
  inboxItemLookup: { findInboxItemByReviewId: vi.fn(async () => null) },
  workState: waitingWorkState(),
  clock: () => NOW,
  logger: createMockLogger(),
  receipts: { insertReceipt: vi.fn(async () => undefined) },
})

const siteUpdated = (
  approvalState: 'pending' | 'approved' | 'disabled' | 'quarantined',
): ConsumerEvent => ({
  eventId: '99000000-0000-4000-8000-0000000000aa',
  eventType: 'portal.approved_destination.updated',
  eventVersion: 1,
  payload: {
    approvedDestinationId: SITE,
    organizationId: ORG,
    propertyId: PROPERTY,
    approvalState,
    sourceAggregateVersion: OCCURRED_AT.toISOString(),
    occurredAt: OCCURRED_AT.toISOString(),
  },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'portal',
  sourceAggregateId: SITE,
  occurredAt: OCCURRED_AT.toISOString(),
  recordedAt: OCCURRED_AT.toISOString(),
})

beforeAll(() => {
  registerAllEventSchemas()
})

describe('a site decided by an account admin', () => {
  it.each(['approved', 'disabled', 'quarantined'] as const)(
    'withdraws every admin’s notice and its queued mail when the site is %s',
    async (state) => {
      const deps = makeDeps()

      await expect(
        handleNotificationSettlementEvent(deps, siteUpdated(state)),
      ).resolves.toEqual({ status: 'applied' })

      // Filed under the site itself, so another site's notice is not touched.
      expect(deps.notifications.settleUnreadForResource).toHaveBeenCalledWith({
        organizationId: ORG,
        types: ['portal.link_approval'],
        resourceId: SITE,
        resolvedAt: NOW,
      })
      expect(deps.emails.cancelQueuedForNotifications).toHaveBeenCalledWith(
        [SETTLED],
        ORG,
        SETTLED_EMAIL_REASON,
        NOW,
      )
      expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
        '99000000-0000-4000-8000-0000000000aa',
        'notification.settle-on-portal-destination-decided',
        'applied',
      )
    },
  )

  it('leaves the notice alone for a site that is waiting', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationSettlementEvent(deps, siteUpdated('pending')),
    ).resolves.toEqual({ status: 'applied' })

    // The raising route announces it; this one has nothing to finish.
    expect(deps.notifications.settleUnreadForResource).not.toHaveBeenCalled()
    expect(deps.emails.cancelQueuedForNotifications).not.toHaveBeenCalled()
  })

  it('keeps the notice when the owner says the site is waiting again', async () => {
    const deps = makeDeps()
    deps.workState.finished.mockResolvedValue([])

    await handleNotificationSettlementEvent(deps, siteUpdated('approved'))

    expect(deps.notifications.settleUnreadForResource).not.toHaveBeenCalled()
    expect(deps.emails.cancelQueuedForNotifications).not.toHaveBeenCalled()
  })

  it('cancels no mail when the notice was already settled', async () => {
    const deps = makeDeps()
    deps.notifications.settleUnreadForResource.mockResolvedValue([])

    await handleNotificationSettlementEvent(deps, siteUpdated('disabled'))

    expect(deps.emails.cancelQueuedForNotifications).not.toHaveBeenCalled()
  })

  it('refuses a fact whose tenant disagrees with its envelope', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationSettlementEvent(deps, {
        ...siteUpdated('approved'),
        organizationId: 'organization-other',
      }),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.notifications.settleUnreadForResource).not.toHaveBeenCalled()
  })
})

describe('the notice’s email', () => {
  const notice = { type: 'portal.link_approval' as const }

  it('is not sent once the site is decided', () => {
    expect(
      isStillActionable({ ...notice, status: 'unread', readAt: null, resolvedAt: NOW }),
    ).toBe(false)
  })

  it('is not sent to an admin who read it in the app, as for any other request', () => {
    expect(
      isStillActionable({ ...notice, status: 'read', readAt: NOW, resolvedAt: null }),
    ).toBe(false)
  })

  it('is sent while the site waits and nobody has looked', () => {
    expect(
      isStillActionable({ ...notice, status: 'unread', readAt: null, resolvedAt: null }),
    ).toBe(true)
  })
})
