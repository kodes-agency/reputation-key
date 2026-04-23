// Identity context — remove member use case tests
// Per architecture: "Every use case tested for happy path + every error path."

import { describe, it, expect } from 'vitest'
import { removeMember } from './remove-member'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'

const setup = () => {
  const identity = createInMemoryIdentityPort()
  const events = createCapturingEventBus()
  const useCase = removeMember({ identity, events })
  return { useCase, identity, events }
}

describe('removeMember', () => {
  it('allows PropertyManager to remove a member', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase({ memberId: 'member-1' }, ctx)

    expect(result.success).toBe(true)
    expect(events.capturedEvents).toHaveLength(1)
    expect(events.capturedEvents[0]._tag).toBe('member.removed')
  })

  it('allows AccountAdmin to remove a member', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase({ memberId: 'member-1' }, ctx)
    expect(result.success).toBe(true)
  })

  it('rejects Staff from removing members', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ memberId: 'member-1' }, ctx)).rejects.toSatisfy(
      (e) => isIdentityError(e) && e.code === 'forbidden',
    )
  })

  it('emits member.removed event with correct data', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase({ memberId: 'member-1' }, ctx)

    const emitted = events.capturedByTag('member.removed')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].organizationId).toBe(ctx.organizationId)
    expect(emitted[0].removedBy).toBe(ctx.userId)
  })
})
