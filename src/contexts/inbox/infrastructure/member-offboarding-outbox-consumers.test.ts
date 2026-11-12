import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createConsumerRegistry, type ConsumerEvent } from '#/shared/outbox'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { registerInboxMemberOffboardingConsumers } from './member-offboarding-outbox-consumers'

const ORG = 'org-inbox-offboarding'
const MEMBER = 'user-departing'
const ADMIN = 'user-admin'
const NOW = new Date('2026-11-11T10:00:00.000Z')

const removed = (removedBy?: string): ConsumerEvent => ({
  eventId: '79000000-0000-4000-8000-000000000003',
  eventType: 'identity.member.removed',
  eventVersion: 1,
  organizationId: ORG,
  propertyId: null,
  sourceContext: 'identity',
  sourceAggregateId: MEMBER,
  occurredAt: NOW.toISOString(),
  payload: { organizationId: ORG, userId: MEMBER, ...(removedBy ? { removedBy } : {}) },
})

function setup() {
  const deps = {
    db: { insert: vi.fn() },
    commandStore: {
      releaseIneligibleAssignmentsForUser: vi.fn(async () => ({ released: 1 })),
    },
    clock: () => NOW,
  }
  const onConflictDoNothing = vi.fn(async () => undefined)
  const values = vi.fn(() => ({ onConflictDoNothing }))
  deps.db.insert.mockReturnValue({ values })
  const registry = createConsumerRegistry()
  registerInboxMemberOffboardingConsumers(
    registry,
    deps as unknown as Parameters<typeof registerInboxMemberOffboardingConsumers>[1],
  )
  const [registration] = registry.listFor('identity.member.removed')
  return { deps, values, run: registration!.handler }
}

beforeAll(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(() => {
  clearEventSchemas()
})

describe('inbox member offboarding consumer', () => {
  it('releases the removed member with the offboarded reason, then records the receipt', async () => {
    const { deps, values, run } = setup()

    await expect(run(removed(ADMIN))).resolves.toEqual({ status: 'applied' })

    expect(deps.commandStore.releaseIneligibleAssignmentsForUser).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: MEMBER,
      actorId: ADMIN,
      releaseReason: 'member_offboarded',
      at: NOW,
    })
    expect(values).toHaveBeenCalledWith({
      eventId: '79000000-0000-4000-8000-000000000003',
      consumerName: 'inbox.on-member-removed',
      status: 'applied',
    })
  })

  it('passes a null actor when nobody is recorded as the remover', async () => {
    const { deps, run } = setup()

    await run(removed())

    expect(deps.commandStore.releaseIneligibleAssignmentsForUser).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null }),
    )
  })

  it('records no receipt when the release fails, so the fact is redelivered', async () => {
    const { deps, values, run } = setup()
    deps.commandStore.releaseIneligibleAssignmentsForUser.mockRejectedValueOnce(
      new Error('boom'),
    )

    await expect(run(removed(ADMIN))).rejects.toThrow('boom')
    expect(values).not.toHaveBeenCalled()
  })
})
