// Identity context — list invitations use case tests
// Thin use case: authorization check + delegation. Tests cover auth pass/fail.

import { describe, it, expect } from 'vitest'
import { listInvitations } from './list-invitations'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import type { InvitationRecord } from '../ports/identity.port'

const PENDING_INVITATION: InvitationRecord = {
  id: 'inv-1',
  email: 'new@test.com',
  role: 'Staff',
  status: 'pending',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  createdAt: new Date(),
}

const setup = () => {
  const identity = createInMemoryIdentityPort()
  const useCase = listInvitations({ identity })
  return { useCase, identity }
}

describe('listInvitations', () => {
  it('allows PropertyManager to list invitations', async () => {
    const { useCase, identity } = setup()
    identity.seedInvitations([PENDING_INVITATION])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(undefined, ctx)

    expect(result.invitations).toHaveLength(1)
    expect(result.invitations[0].id).toBe('inv-1')
  })

  it('allows AccountAdmin to list invitations', async () => {
    const { useCase, identity } = setup()
    identity.seedInvitations([PENDING_INVITATION])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase(undefined, ctx)
    expect(result.invitations).toHaveLength(1)
  })

  it('rejects Staff from listing invitations', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase(undefined, ctx)).rejects.toSatisfy(
      (e) => isIdentityError(e) && e.code === 'forbidden',
    )
  })
})
