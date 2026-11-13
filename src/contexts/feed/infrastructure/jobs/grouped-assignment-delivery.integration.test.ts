// A grouped assignment mailed after part of it moved on.
//
// The audience check counts the items still assigned to the recipient and the
// work check counted the items still open, so a recipient who kept six of ten
// open items was mailed "10 items assigned to you" once four of them went to a
// colleague. The send restates the count (Feed CONTEXT, Runtime): it is the
// items that are still the recipient's and still open.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inboxItemId, organizationId, userId } from '#/shared/domain/ids'
import type { HandlingCycleNotificationFacts } from '../../application/ports/notification-inbox-item-lookup.port'
import { findNotificationEmailById } from '../../email/notification-email-queue.server'
import { createNotificationWorkState } from '../../notify/settle.server'
import { loadItems, type RecipientContext } from './digest-entry-selection'
import { seedPropertyPreference } from './delivery-seed'
import {
  NOW,
  ORG,
  PROPERTY,
  USER,
  openSendWorld,
  type SendEmailsTestDeps,
  type SendWorld,
} from './send-emails-test-deps'

const COLLEAGUE = 'send-emails-colleague'
const ITEM_IDS = Array.from({ length: 10 }, (_unused, index) => `item-${index + 1}`)

/** Ten open items; the recipient still holds the first six, a colleague the rest. */
const itemFacts = (item: string): HandlingCycleNotificationFacts => ({
  propertyId: PROPERTY,
  portalId: null,
  assignedTo: userId(ITEM_IDS.indexOf(item) < 6 ? USER : COLLEAGUE),
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

const notice = {
  type: 'inbox.bulk_assigned' as const,
  category: 'workflow_collaboration' as const,
  priority: 'normal' as const,
  resourceType: 'inbox_item' as const,
  resourceId: 'item-1',
  payload: { propertyName: 'Riverside Hotel', itemCount: 10 },
}
const audience = { kind: 'bulk_inbox_assignee', inboxItemIds: ITEM_IDS }

let world: SendWorld

afterEach(async () => {
  await world.rollBack()
})

describe('the immediate email of a grouped assignment', () => {
  beforeEach(async () => {
    world = await openSendWorld({
      notice: { ...notice, email: { recipientAudience: audience } },
    })
    await seedPropertyPreference(world.db, {
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      category: 'workflow_collaboration',
      enabled: true,
      cadence: 'immediate',
    })
  })

  it('counts only the items still assigned to the recipient', async () => {
    const deps = { ...world.deps(), workState: workState() }

    await world.run(deps as unknown as SendEmailsTestDeps)

    expect(deps.emailSender.send.mock.calls[0]![0].subject).toContain(
      '6 items assigned to you',
    )
  })
})

describe('the digest line of a grouped assignment', () => {
  it('counts only the items still assigned to the recipient', async () => {
    world = await openSendWorld({
      notice: { ...notice, email: { cadence: 'daily', recipientAudience: audience } },
    })
    const entry = await findNotificationEmailById(
      world.db,
      world.notice.emailId,
      ORG,
      PROPERTY,
    )
    const ctx = {
      orgId: organizationId(ORG),
      userId: userId(USER),
      rawOrgId: ORG,
      now: NOW,
      timezone: 'UTC',
      timezoneSource: 'fallback',
      quietHours: { quietHoursStart: null, quietHoursEnd: null },
    } as unknown as RecipientContext
    const deps = { ...world.deps(), workState: workState() }

    const [item] = await loadItems(deps as never, ctx, [entry!])

    expect(item!.notification.payload).toMatchObject({ itemCount: 6 })
  })
})
