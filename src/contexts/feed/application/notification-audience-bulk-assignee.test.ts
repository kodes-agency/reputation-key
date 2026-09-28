// A grouped "N items assigned to you" notice, checked when it is delivered.
//
// The per-item facts of a bulk assignment notify nobody, so the grouped
// notice is the recipient's only news of every item in it. One item moving on
// before delivery must not silence the rest: the notice stands for the items
// that are still theirs and says how many.

import { describe, expect, it, vi } from 'vitest'
import { inboxItemId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import { createNotificationAudienceAuthorizer } from './notification-audience'
import type { InboxItemFacts } from './ports/notification-inbox-item-lookup.port'

const ORG = organizationId('org-bulk-assignee')
const PROPERTY = propertyId('55555555-5555-4555-8555-555555555555')
const OTHER_PROPERTY = propertyId('66666666-6666-4666-8666-666666666666')
const RECIPIENT = userId('bulk-assignee')
const ITEMS = [
  inboxItemId('55555555-5555-4555-8555-000000000001'),
  inboxItemId('55555555-5555-4555-8555-000000000002'),
  inboxItemId('55555555-5555-4555-8555-000000000003'),
]

const facts = (overrides: Partial<InboxItemFacts> = {}): InboxItemFacts => ({
  propertyId: PROPERTY,
  portalId: null,
  assignedTo: RECIPIENT,
  propertyName: null,
  guestRating: null,
  sourceType: 'review',
  createdAt: new Date('2026-08-25T10:00:00Z'),
  ...overrides,
})

const buildDeps = (items: ReadonlyArray<InboxItemFacts | null>, eligible = true) => {
  const byId = new Map(ITEMS.map((id, index) => [id, items[index] ?? null]))
  return {
    userLookup: { findByRole: vi.fn().mockResolvedValue([]) },
    responsibleManagers: {
      findForProperty: vi.fn().mockResolvedValue([]),
      findForPortal: vi.fn().mockResolvedValue([]),
      findForPortalGroup: vi.fn().mockResolvedValue([]),
      isEligibleForProperty: vi.fn().mockResolvedValue(eligible),
    },
    inboxItemLookup: {
      findInboxItemFacts: vi.fn(async (id: string) => byId.get(inboxItemId(id)) ?? null),
      findNoteAuthors: vi.fn().mockResolvedValue([]),
      findHandlingCycleNotificationFacts: vi.fn().mockResolvedValue(null),
      findResponseTargetReminderNotificationFacts: vi.fn().mockResolvedValue(null),
    },
    escalationResolutions: { findEscalationResolutionFacts: vi.fn() },
    replyApproval: { canApproveReplies: vi.fn() },
    notifications: { findRecipientsOfNotice: vi.fn() },
    portalHealthLookup: { findPortalHealthNotificationFacts: vi.fn() },
    monthlyResultFacts: {
      findMonthlyResultNotificationFacts: vi.fn(),
      findMonthlyResultRevisionNotificationFacts: vi.fn(),
    },
    organizationAccountAuthority: { isAffectedRecipient: vi.fn() },
  }
}

const decide = (deps: ReturnType<typeof buildDeps>) =>
  createNotificationAudienceAuthorizer(deps)({
    userId: RECIPIENT,
    organizationId: ORG,
    propertyId: PROPERTY,
    audience: { kind: 'bulk_inbox_assignee', inboxItemIds: ITEMS },
  })

describe('a grouped assignment notice at delivery', () => {
  it('counts every item while all of them are still the recipient’s', async () => {
    await expect(decide(buildDeps([facts(), facts(), facts()]))).resolves.toEqual({
      itemCount: 3,
    })
  })

  it('stands for the items that are still theirs when one moved on', async () => {
    const deps = buildDeps([
      facts(),
      facts({ assignedTo: userId('somebody-else') }),
      facts(),
    ])

    await expect(decide(deps)).resolves.toEqual({ itemCount: 2 })
  })

  it('leaves out an item that is gone or now belongs to another Property', async () => {
    const deps = buildDeps([facts(), null, facts({ propertyId: OTHER_PROPERTY })])

    await expect(decide(deps)).resolves.toEqual({ itemCount: 1 })
  })

  it('says nothing once none of the items is theirs any more', async () => {
    const deps = buildDeps([
      facts({ assignedTo: null }),
      facts({ assignedTo: userId('somebody-else') }),
      null,
    ])

    await expect(decide(deps)).resolves.toBe(false)
  })

  it('says nothing to a recipient who can no longer act on the Property', async () => {
    await expect(decide(buildDeps([facts(), facts(), facts()], false))).resolves.toBe(
      false,
    )
  })
})
