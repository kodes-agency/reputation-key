// Identity context — last-owner guard tests.

import { describe, expect, it } from 'vitest'
import { assertAnotherOwnerRemains } from './last-owner-guard'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import type { MemberRecord } from '../ports/identity.port'

const REFUSAL = 'Cannot change the last admin of the organization'

const memberWith = (id: string, rawRole: string): MemberRecord => ({
  id,
  userId: `user-${id}`,
  email: `${id}@test.com`,
  name: id,
  role: null,
  rawRole,
  image: null,
  createdAt: new Date('2026-01-01'),
})

const identityWith = (members: ReadonlyArray<MemberRecord>) => {
  const identity = createInMemoryIdentityPort()
  identity.seedMembers(members)
  return identity
}

describe('assertAnotherOwnerRemains', () => {
  it('refuses with the given message when the target is the only owner', async () => {
    const identity = identityWith([memberWith('a', 'owner'), memberWith('b', 'member')])

    await expect(
      assertAnotherOwnerRemains(identity, buildTestAuthContext(), REFUSAL),
    ).rejects.toMatchObject({ code: 'forbidden', message: REFUSAL })
  })

  it('passes when a second owner exists', async () => {
    const identity = identityWith([memberWith('a', 'owner'), memberWith('b', 'owner')])

    await expect(
      assertAnotherOwnerRemains(identity, buildTestAuthContext(), REFUSAL),
    ).resolves.toBeUndefined()
  })

  it('counts a multi-role owner whose built-in role is null', async () => {
    const identity = identityWith([
      memberWith('a', 'owner'),
      memberWith('b', 'owner,editor'),
    ])

    await expect(
      assertAnotherOwnerRemains(identity, buildTestAuthContext(), REFUSAL),
    ).resolves.toBeUndefined()
  })
})
