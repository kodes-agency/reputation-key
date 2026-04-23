// Identity context — invite member use case tests
// Per architecture: "Every use case tested for happy path + every error path."

import { describe, it, expect } from 'vitest'
import { inviteMember } from './invite-member'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'

const setup = () => {
  const identity = createInMemoryIdentityPort()
  const events = createCapturingEventBus()
  const useCase = inviteMember({ identity, events })
  return { useCase, identity, events }
}

describe('inviteMember', () => {
  it('allows PropertyManager to invite a Staff member', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase({ email: 'new@test.com', role: 'Staff' }, ctx)

    expect(result.success).toBe(true)
    expect(events.capturedEvents).toHaveLength(1)
    expect(events.capturedEvents[0]._tag).toBe('member.invited')
  })

  it('allows AccountAdmin to invite with any role', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase({ email: 'admin@test.com', role: 'AccountAdmin' }, ctx)
    expect(result.success).toBe(true)
  })

  it('rejects Staff from inviting anyone', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase({ email: 'any@test.com', role: 'Staff' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('rejects PropertyManager inviting AccountAdmin', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ email: 'admin@test.com', role: 'AccountAdmin' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('emits member.invited event with correct data', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase({ email: 'new@test.com', role: 'Staff' }, ctx)

    const emitted = events.capturedByTag('member.invited')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].email).toBe('new@test.com')
    expect(emitted[0].role).toBe('Staff')
    expect(emitted[0].organizationId).toBe(ctx.organizationId)
  })
})
