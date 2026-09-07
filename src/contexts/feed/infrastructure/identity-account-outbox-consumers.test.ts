import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  handleIdentityAccountNotificationEvent,
  handleOrganizationPurgePendingNotice,
  IDENTITY_ACCOUNT_NOTIFICATION_CONSUMERS,
  ORGANIZATION_PURGE_PENDING_CONSUMER,
  registerIdentityAccountNotificationConsumers,
} from './identity-account-outbox-consumers'
import { createNotificationConsumerDeps } from './notification-consumer-test-fixtures'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const ORG = 'org-account-notice'
const EVENT_ID = '91000000-0000-4000-8000-000000000001'

const event = (overrides: Partial<ConsumerEvent> = {}): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'identity.member.role_changed',
  eventVersion: 1,
  payload: {
    organizationId: ORG,
    userId: 'admin-actor',
    memberUserId: 'affected-user',
    previousRole: 'Staff',
    newRole: 'PropertyManager',
  },
  organizationId: ORG,
  propertyId: null,
  sourceContext: 'identity',
  sourceAggregateId: 'affected-user',
  recordedAt: '2026-08-28T00:00:00.000Z',
  ...overrides,
})

const makeDeps = () => {
  const fakes = createNotificationConsumerDeps()
  return {
    queue: fakes.queue,
    receipts: { insertReceipt: vi.fn(async () => undefined) },
    userLookup: fakes.userLookup,
    logger: fakes.logger,
    fakes,
  }
}

describe('Identity account mandatory notification consumers', () => {
  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
  })

  it('registers only the three existing durable affected-account facts', () => {
    registerIdentityAccountNotificationConsumers(consumerRegistry, makeDeps())

    expect(consumerRegistry.list()).toEqual(
      expect.arrayContaining(
        IDENTITY_ACCOUNT_NOTIFICATION_CONSUMERS.map(({ eventType, consumerName }) => ({
          eventType,
          consumerName,
        })),
      ),
    )
    expect(consumerRegistry.list()).not.toContainEqual(
      expect.objectContaining({ eventType: 'identity.member.invited' }),
    )
  })

  it('enqueues the role-change notice for the target, never the actor', async () => {
    const deps = makeDeps()

    await expect(handleIdentityAccountNotificationEvent(deps, event())).resolves.toEqual({
      status: 'applied',
    })

    expect(deps.queue.add).toHaveBeenCalledWith(
      'insert-notification',
      {
        userId: 'affected-user',
        organizationId: ORG,
        propertyId: null,
        type: 'account.organization_role_changed',
        resourceType: 'organization',
        resourceId: ORG,
        eventId: EVENT_ID,
        audience: {
          kind: 'affected_organization_user',
          eventId: EVENT_ID,
          eventType: 'identity.member.role_changed',
        },
      },
      { jobId: `${EVENT_ID}-affected-user` },
    )
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      'notification.on-identity-member-role-changed',
      'applied',
    )
  })

  it.each([
    {
      eventType: 'identity.invitation.accepted',
      payload: {
        organizationId: ORG,
        userId: 'affected-user',
        invitationId: 'invitation-1',
      },
      type: 'account.organization_access_granted',
    },
    {
      eventType: 'identity.member.removed',
      payload: { organizationId: ORG, userId: 'affected-user' },
      type: 'account.organization_access_removed',
    },
  ])('maps $eventType to $type', async ({ eventType, payload, type }) => {
    const deps = makeDeps()
    await handleIdentityAccountNotificationEvent(deps, event({ eventType, payload }))

    expect(deps.queue.add).toHaveBeenCalledWith(
      'insert-notification',
      expect.objectContaining({ type, userId: 'affected-user' }),
      { jobId: `${EVENT_ID}-affected-user` },
    )
  })

  it('fails closed before enqueue or receipt on envelope attribution mismatch', async () => {
    const deps = makeDeps()
    await expect(
      handleIdentityAccountNotificationEvent(
        deps,
        event({ organizationId: 'another-org' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.queue.add).not.toHaveBeenCalled()
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})

// LIF-01 program bullet 5 — the mandatory final notice at Purge Pending.
describe('Purge Pending final-notice consumer', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => {
    clearEventSchemas()
  })

  const lifecycleEvent = (state: string): ConsumerEvent => ({
    eventId: EVENT_ID,
    eventType: 'identity.organization_lifecycle.changed',
    eventVersion: 1,
    payload: {
      organizationId: ORG,
      closureLineageId: '11111111-1111-4111-8111-111111111111',
      state,
      revision: 4,
      reactivationRequired: true,
      recoverableUntil: '2026-09-27T09:30:00.000Z',
      occurredAt: '2026-09-27T09:30:00.000Z',
    },
    organizationId: ORG,
    propertyId: null,
    sourceContext: 'identity',
    sourceAggregateId: ORG,
    recordedAt: '2026-09-27T09:30:00.000Z',
  })

  it('sends the notice at purge_pending', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue(['admin-1'])

    const result = await handleOrganizationPurgePendingNotice(
      deps,
      lifecycleEvent('purge_pending'),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(deps.queue.add).toHaveBeenCalledWith(
      'insert-notification',
      expect.objectContaining({
        userId: 'admin-1',
        type: 'account.organization_purge_pending',
        eventId: EVENT_ID,
      }),
      { jobId: `${EVENT_ID}-admin-1` },
    )
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ORGANIZATION_PURGE_PENDING_CONSUMER,
      'applied',
    )
  })

  it.each(['closure_requested', 'closing', 'purging', 'closed', 'active'])(
    'records an obsolete receipt and sends nothing for %s',
    async (state) => {
      const deps = makeDeps()

      const result = await handleOrganizationPurgePendingNotice(
        deps,
        lifecycleEvent(state),
      )

      expect(result).toEqual({ status: 'obsolete' })
      expect(deps.queue.add).not.toHaveBeenCalled()
      expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
        EVENT_ID,
        ORGANIZATION_PURGE_PENDING_CONSUMER,
        'obsolete',
      )
    },
  )

  it('refuses a mis-attributed envelope rather than notifying the wrong tenant', async () => {
    const deps = makeDeps()

    await expect(
      handleOrganizationPurgePendingNotice(deps, {
        ...lifecycleEvent('purge_pending'),
        organizationId: 'org-other',
      }),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.queue.add).not.toHaveBeenCalled()
  })
})
