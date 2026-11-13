// A site that was waiting for an account admin stops asking once it is decided
// (ADR 0046, amended 2026-10-26). Approved, turned off or held back for safety:
// whichever it was, nobody is left to decide it, so every admin's notice and
// the mail queued behind it go. A site that is waiting again keeps its notice.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { propertyId } from '#/shared/domain/ids'
import { isStillActionable } from '../domain/notification-actionable'
import { seedProperty } from '#/shared/db/testing/notification-test-db'
import { seedNotice } from './jobs/delivery-seed'
import { handleNotificationSettlementEvent } from './notification-settlement-outbox-consumers'
import {
  MAIL_CANCELLED,
  MAIL_QUEUED,
  queuedMail,
  settledAt,
  settlementDeps,
} from './notification-settlement-test-db'

const ORG = 'organization-site-decided'
const PROPERTY = propertyId('99000000-0000-4000-8000-000000000001')
const SITE = '99000000-0000-4000-8000-000000000002'
const OTHER_SITE = '99000000-0000-4000-8000-000000000003'
const NOW = new Date('2026-10-26T07:00:00.000Z')
const OCCURRED_AT = new Date('2026-10-26T06:30:00.000Z')

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

describe.sequential('a site decided by an account admin (real PostgreSQL)', () => {
  let held: HeldTransaction

  const request = (name: string, resourceId: string = SITE) =>
    seedNotice(held.db, {
      name,
      organizationId: ORG,
      userId: `admin-${name}`,
      propertyId: PROPERTY,
      createdAt: OCCURRED_AT,
      type: 'portal.link_approval',
      resourceType: 'portal_destination',
      resourceId,
    })

  beforeAll(async () => {
    registerAllEventSchemas()
    held = await holdTransaction()
    await seedProperty(held.db, { id: PROPERTY, organizationId: ORG })
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  it.each(['approved', 'disabled', 'quarantined'] as const)(
    'withdraws every admin’s notice and its queued mail when the site is %s',
    async (state) => {
      await request(`${state}-first`)
      await request(`${state}-second`)
      // Filed under the site itself, so another site's notice is not touched.
      await request(`${state}-elsewhere`, OTHER_SITE)
      const deps = settlementDeps(held.db, { now: NOW })

      await expect(
        handleNotificationSettlementEvent(deps, siteUpdated(state)),
      ).resolves.toEqual({ status: 'applied' })

      for (const name of [`${state}-first`, `${state}-second`]) {
        expect(await settledAt(held.db, name)).toEqual(NOW)
        expect(await queuedMail(held.db, name)).toEqual(MAIL_CANCELLED)
      }
      expect(await settledAt(held.db, `${state}-elsewhere`)).toBeNull()
      expect(await queuedMail(held.db, `${state}-elsewhere`)).toEqual(MAIL_QUEUED)
      expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
        '99000000-0000-4000-8000-0000000000aa',
        'notification.settle-on-portal-destination-decided',
        'applied',
      )
    },
  )

  it('leaves the notice alone for a site that is waiting', async () => {
    await request('waiting')

    await expect(
      handleNotificationSettlementEvent(
        settlementDeps(held.db, { now: NOW }),
        siteUpdated('pending'),
      ),
    ).resolves.toEqual({ status: 'applied' })

    // The raising route announces it; this one has nothing to finish.
    expect(await settledAt(held.db, 'waiting')).toBeNull()
    expect(await queuedMail(held.db, 'waiting')).toEqual(MAIL_QUEUED)
  })

  it('keeps the notice when the owner says the site is waiting again', async () => {
    await request('waiting-again')
    const deps = settlementDeps(held.db, { now: NOW })
    deps.workState.finished.mockResolvedValue([])

    await handleNotificationSettlementEvent(deps, siteUpdated('approved'))

    expect(await settledAt(held.db, 'waiting-again')).toBeNull()
    expect(await queuedMail(held.db, 'waiting-again')).toEqual(MAIL_QUEUED)
  })

  it('cancels no mail when the notice was already settled', async () => {
    await seedNotice(held.db, {
      name: 'already-settled',
      organizationId: ORG,
      userId: 'admin-already-settled',
      propertyId: PROPERTY,
      createdAt: OCCURRED_AT,
      type: 'portal.link_approval',
      resourceType: 'portal_destination',
      resourceId: SITE,
      resolvedAt: OCCURRED_AT,
    })

    await handleNotificationSettlementEvent(
      settlementDeps(held.db, { now: NOW }),
      siteUpdated('disabled'),
    )

    expect(await settledAt(held.db, 'already-settled')).toEqual(OCCURRED_AT)
    expect(await queuedMail(held.db, 'already-settled')).toEqual(MAIL_QUEUED)
  })

  it('refuses a fact whose tenant disagrees with its envelope', async () => {
    await request('cross-tenant')

    await expect(
      handleNotificationSettlementEvent(settlementDeps(held.db, { now: NOW }), {
        ...siteUpdated('approved'),
        organizationId: 'organization-other',
      }),
    ).rejects.toThrow('attribution mismatch')
    expect(await settledAt(held.db, 'cross-tenant')).toBeNull()
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
        isStillActionable({
          ...notice,
          status: 'unread',
          readAt: null,
          resolvedAt: null,
        }),
      ).toBe(true)
    })
  })
})
