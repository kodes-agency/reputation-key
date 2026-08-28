import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  clearConsumers,
  listRegisteredConsumers,
} from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  handleIdentityAccountNotificationEvent,
  IDENTITY_ACCOUNT_NOTIFICATION_CONSUMERS,
  registerIdentityAccountNotificationConsumers,
} from './identity-account-outbox-consumers'

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

const makeDeps = () => ({
  queue: { add: vi.fn(async () => undefined) },
  receipts: { insertReceipt: vi.fn(async () => undefined) },
})

describe('Identity account mandatory notification consumers', () => {
  beforeEach(() => {
    clearConsumers()
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => {
    clearConsumers()
    clearEventSchemas()
  })

  it('registers only the three existing durable affected-account facts', () => {
    registerIdentityAccountNotificationConsumers(makeDeps())

    expect(listRegisteredConsumers()).toEqual(
      expect.arrayContaining(
        IDENTITY_ACCOUNT_NOTIFICATION_CONSUMERS.map(({ eventType, consumerName }) => ({
          eventType,
          consumerName,
        })),
      ),
    )
    expect(listRegisteredConsumers()).not.toContainEqual(
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
