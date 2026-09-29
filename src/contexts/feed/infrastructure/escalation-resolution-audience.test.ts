// Who hears that an escalation was resolved: the people who were told it was
// raised, and not the people who were told about some other escalation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { inboxItemId, propertyId, userId, type UserId } from '#/shared/domain/ids'
import type { InboxItemFacts } from '../application/ports/notification-inbox-item-lookup.port'
import { handleNotificationInboxEscalationResolved } from './escalation-resolution-outbox-consumers'

const ORG = 'organization-resolution-audience'
const ITEM = inboxItemId('93000000-0000-4000-8000-000000000002')
const PROPERTY = propertyId('93000000-0000-4000-8000-000000000003')
const PORTAL = '93000000-0000-4000-8000-000000000004'
const RESOLVER = userId('resolver-resolution-audience')
const PROPERTY_MANAGER = userId('property-manager-resolution-audience')
const PORTAL_MANAGER = userId('portal-manager-resolution-audience')
const EARLIER_ADMIN = userId('earlier-admin-resolution-audience')
const ESCALATED_AT = new Date('2026-08-27T07:00:00.000Z')
const RESOLVED_AT = new Date('2026-08-27T08:00:00.000Z')

const resolvedEvent = (): ConsumerEvent => ({
  eventId: '93000000-0000-4000-8000-000000000001',
  eventType: 'inbox.inbox_item.escalation_resolved',
  eventVersion: 1,
  payload: {
    inboxItemId: ITEM,
    organizationId: ORG,
    propertyId: PROPERTY,
    userId: RESOLVER,
    source: 'web',
    occurredAt: RESOLVED_AT.toISOString(),
  },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'inbox',
  sourceAggregateId: ITEM,
  occurredAt: RESOLVED_AT.toISOString(),
  recordedAt: RESOLVED_AT.toISOString(),
})

const itemFacts = (overrides: Partial<InboxItemFacts>): InboxItemFacts => ({
  propertyId: PROPERTY,
  portalId: null,
  assignedTo: null,
  propertyName: 'Riverside Hotel',
  guestRating: null,
  sourceType: 'review',
  createdAt: new Date('2026-08-20T09:00:00.000Z'),
  ...overrides,
})

/** No assignee, so the resolution falls to the item's responsible scope. */
const makeDeps = (item: InboxItemFacts) => {
  const jobs: Array<{ data: unknown }> = []
  return {
    queue: {
      add: vi.fn(async (_name: string, data: unknown) => {
        jobs.push({ data })
      }),
    },
    escalationResolutions: {
      findEscalationResolutionFacts: vi.fn(async () => ({
        propertyId: PROPERTY,
        assignedTo: null,
        propertyName: 'Riverside Hotel',
        isEscalated: false,
        escalatedAt: ESCALATED_AT,
        resolvedAt: RESOLVED_AT,
        resolvedBy: RESOLVER,
      })),
    },
    inboxItemLookup: { findInboxItemFacts: vi.fn(async () => item) },
    responsibleManagers: {
      findForProperty: vi.fn(async () => [PROPERTY_MANAGER]),
      findForPortal: vi.fn(async () => [PORTAL_MANAGER]),
      findForPortalGroup: vi.fn(async () => []),
      isEligibleForProperty: vi.fn(async () => true),
    },
    userLookup: {
      findByRole: vi.fn(async (): Promise<readonly UserId[]> => [EARLIER_ADMIN]),
    },
    notifications: {
      findRecipientsOfNotice: vi.fn(async (): Promise<readonly UserId[]> => []),
    },
    receipts: { insertReceipt: vi.fn(async () => undefined) },
    jobs,
  }
}

const recipientsOf = (deps: ReturnType<typeof makeDeps>) =>
  deps.jobs.map((job) => (job.data as { userId: string }).userId)

describe('who hears that an escalation was resolved', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => clearEventSchemas())

  // The escalation of private feedback went to the Portal's managers.
  it('tells the Portal managers who were told a feedback item was escalated', async () => {
    const deps = makeDeps(itemFacts({ sourceType: 'feedback', portalId: PORTAL }))

    await handleNotificationInboxEscalationResolved(deps, resolvedEvent())

    expect(recipientsOf(deps)).toEqual([PORTAL_MANAGER])
    expect(deps.responsibleManagers.findForProperty).not.toHaveBeenCalled()
  })

  it('still tells the Property managers about a review', async () => {
    const deps = makeDeps(itemFacts({ sourceType: 'review' }))

    await handleNotificationInboxEscalationResolved(deps, resolvedEvent())

    expect(recipientsOf(deps)).toEqual([PROPERTY_MANAGER])
  })

  // Feedback no Portal can be found for was escalated to the AccountAdmins,
  // and the admins who were told hear the resolution through their evidence.
  it('reaches no manager for feedback whose Portal is unknown', async () => {
    const deps = makeDeps(itemFacts({ sourceType: 'feedback', portalId: null }))

    await handleNotificationInboxEscalationResolved(deps, resolvedEvent())

    expect(recipientsOf(deps)).toEqual([])
  })

  // An admin told about an EARLIER escalation of the item was never told
  // about this one, so only notices that arrived since it was raised count.
  it('reads the evidence of who was told from this escalation only', async () => {
    const deps = makeDeps(itemFacts({}))

    await handleNotificationInboxEscalationResolved(deps, resolvedEvent())

    expect(deps.notifications.findRecipientsOfNotice).toHaveBeenCalledWith(
      ORG,
      'inbox.escalated',
      ITEM,
      ESCALATED_AT,
    )
  })
})
