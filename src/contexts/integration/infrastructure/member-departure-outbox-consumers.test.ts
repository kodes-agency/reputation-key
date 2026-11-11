import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createConsumerRegistry, type ConsumerEvent } from '#/shared/outbox'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { registerMemberDepartureConsumers } from './member-departure-outbox-consumers'

const ORG = 'org-member-departure'
const MEMBER = 'user-departing'
const ADMIN = 'user-admin'

const fact = (eventType: string, payload: Record<string, unknown>): ConsumerEvent => ({
  eventId: '79000000-0000-4000-8000-000000000002',
  eventType,
  eventVersion: 1,
  organizationId: ORG,
  propertyId: null,
  sourceContext: 'identity',
  sourceAggregateId: MEMBER,
  occurredAt: '2026-11-11T10:00:00.000Z',
  payload,
})

const removed = fact('identity.member.removed', {
  organizationId: ORG,
  userId: MEMBER,
  removedBy: ADMIN,
})

const roleChanged = (previousRole: string, newRole: string) =>
  fact('identity.member.role_changed', {
    organizationId: ORG,
    userId: ADMIN,
    memberUserId: MEMBER,
    previousRole,
    newRole,
  })

function setup(currentRole: 'AccountAdmin' | 'PropertyManager' | null = null) {
  const deps = {
    prepareDeparture: vi.fn(async () => ({
      connectionIds: [],
      transitionedConnectionIds: [],
    })),
    cancelImportsForUser: vi.fn(async () => undefined),
    resolveActiveMember: vi.fn(async () =>
      currentRole === null ? null : buildTestAuthContext({ role: currentRole }),
    ),
    receipts: { insertReceipt: vi.fn(async () => undefined) },
  }
  const registry = createConsumerRegistry()
  registerMemberDepartureConsumers(registry, deps)
  const run = (event: ConsumerEvent) =>
    registry.listFor(event.eventType)[0]!.handler(event)
  return { deps, run }
}

beforeAll(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(() => {
  clearEventSchemas()
})

describe('member departure consumers', () => {
  it("fences a removed member's connections, then cancels their imports, then records the receipt", async () => {
    const { deps, run } = setup()
    const order: string[] = []
    deps.prepareDeparture.mockImplementation(async () => {
      order.push('fence')
      return { connectionIds: [], transitionedConnectionIds: [] }
    })
    deps.cancelImportsForUser.mockImplementation(async () => {
      order.push('cancel')
    })
    deps.receipts.insertReceipt.mockImplementation(async () => {
      order.push('receipt')
    })

    await expect(run(removed)).resolves.toEqual({ status: 'applied' })

    expect(deps.prepareDeparture).toHaveBeenCalledWith({
      organizationId: ORG,
      connectorUserId: MEMBER,
      cause: 'member_removed',
    })
    expect(deps.cancelImportsForUser).toHaveBeenCalledWith(ORG, MEMBER)
    expect(order).toEqual(['fence', 'cancel', 'receipt'])
  })

  it('records no receipt when the release fails, so the fact is delivered again', async () => {
    const { deps, run } = setup()
    deps.cancelImportsForUser.mockRejectedValueOnce(new Error('imports unavailable'))

    await expect(run(removed)).rejects.toThrow('imports unavailable')

    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('leaves a member invited again before delivery alone', async () => {
    const { deps, run } = setup('PropertyManager')

    await expect(run(removed)).resolves.toEqual({ status: 'obsolete' })

    expect(deps.prepareDeparture).not.toHaveBeenCalled()
    expect(deps.cancelImportsForUser).not.toHaveBeenCalled()
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      removed.eventId,
      'integration.on-member-removed',
      'obsolete',
    )
  })

  it('fences the connections of a demoted AccountAdmin', async () => {
    const { deps, run } = setup('PropertyManager')

    await expect(run(roleChanged('AccountAdmin', 'PropertyManager'))).resolves.toEqual({
      status: 'applied',
    })

    expect(deps.prepareDeparture).toHaveBeenCalledWith({
      organizationId: ORG,
      connectorUserId: MEMBER,
      cause: 'account_admin_role_lost',
    })
  })

  it('leaves Google alone for a promotion, or for an AccountAdmin made one again', async () => {
    const promoted = setup('AccountAdmin')
    await expect(
      promoted.run(roleChanged('PropertyManager', 'AccountAdmin')),
    ).resolves.toEqual({ status: 'obsolete' })

    const restored = setup('AccountAdmin')
    await expect(
      restored.run(roleChanged('AccountAdmin', 'PropertyManager')),
    ).resolves.toEqual({ status: 'obsolete' })

    expect(promoted.deps.prepareDeparture).not.toHaveBeenCalled()
    expect(restored.deps.prepareDeparture).not.toHaveBeenCalled()
  })

  it('refuses a fact whose payload names another Organization', async () => {
    const { deps, run } = setup()

    await expect(
      run({
        ...removed,
        payload: { organizationId: 'org-other', userId: MEMBER, removedBy: ADMIN },
      }),
    ).rejects.toThrow('attribution')

    expect(deps.prepareDeparture).not.toHaveBeenCalled()
  })
})
