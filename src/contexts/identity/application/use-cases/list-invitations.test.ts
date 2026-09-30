// Identity context — list invitations use case tests.
// The Members page reads open invitations (pending or expired) from the
// invitation read model, with the inviter's name and the invited Properties.

import { describe, it, expect, vi } from 'vitest'
import { listInvitations } from './list-invitations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import type {
  InvitationReadModel,
  OrganizationInvitationRow,
  PropertyNameLookup,
} from '../ports/invitation-read-model.port'

const NOW = new Date('2026-09-30T12:00:00.000Z')

const row = (patch: Partial<OrganizationInvitationRow>): OrganizationInvitationRow => ({
  id: 'inv-1',
  email: 'new@test.com',
  role: 'admin',
  status: 'pending',
  expiresAt: new Date('2026-10-07T12:00:00.000Z'),
  createdAt: new Date('2026-09-30T11:00:00.000Z'),
  inviterName: 'Ada Admin',
  propertyIds: [],
  ...patch,
})

const setup = (
  rows: ReadonlyArray<OrganizationInvitationRow>,
  names: ReadonlyArray<Readonly<{ id: string; name: string | null }>> = [],
) => {
  const listOpenForOrganization = vi.fn(async () => rows)
  const invitations: InvitationReadModel = {
    findForPreview: vi.fn(async () => null),
    listOpenForOrganization,
  }
  const propertyNames = vi.fn<PropertyNameLookup>(async () => names)
  const useCase = listInvitations({ invitations, propertyNames, clock: () => NOW })
  return { useCase, listOpenForOrganization, propertyNames }
}

describe('listInvitations', () => {
  it("reads the caller's Organization's open invitations with inviter and Properties", async () => {
    const { useCase, listOpenForOrganization, propertyNames } = setup(
      [row({ propertyIds: ['prop-b', 'prop-a'] })],
      [
        { id: 'prop-a', name: 'Hotel A' },
        { id: 'prop-b', name: 'Hotel B' },
      ],
    )
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase(undefined, ctx)

    expect(listOpenForOrganization).toHaveBeenCalledWith(ctx.organizationId)
    expect(propertyNames).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      invitations: [
        {
          id: 'inv-1',
          email: 'new@test.com',
          role: 'PropertyManager',
          rawRole: 'admin',
          status: 'pending',
          createdAt: new Date('2026-09-30T11:00:00.000Z'),
          expiresAt: new Date('2026-10-07T12:00:00.000Z'),
          inviterName: 'Ada Admin',
          properties: [
            { id: 'prop-b', name: 'Hotel B' },
            { id: 'prop-a', name: 'Hotel A' },
          ],
        },
      ],
    })
  })

  it('reads a lapsed pending row and a stored expired row as expired', async () => {
    const { useCase } = setup([
      row({ id: 'inv-lapsed', expiresAt: new Date('2026-09-29T12:00:00.000Z') }),
      row({ id: 'inv-stored', status: 'expired' }),
      row({ id: 'inv-live' }),
    ])

    const result = await useCase(
      undefined,
      buildTestAuthContext({ role: 'AccountAdmin' }),
    )

    expect(result.invitations.map((inv) => [inv.id, inv.status])).toEqual([
      ['inv-lapsed', 'expired'],
      ['inv-stored', 'expired'],
      ['inv-live', 'pending'],
    ])
  })

  it('leaves out an accepted, canceled or rejected row the read model returned', async () => {
    const { useCase } = setup([
      row({ id: 'inv-live' }),
      row({ id: 'inv-accepted', status: 'accepted' }),
      row({ id: 'inv-canceled', status: 'canceled' }),
      row({ id: 'inv-rejected', status: 'rejected' }),
    ])

    const result = await useCase(
      undefined,
      buildTestAuthContext({ role: 'AccountAdmin' }),
    )

    expect(result.invitations.map((inv) => inv.id)).toEqual(['inv-live'])
  })

  it('drops a deleted Property and shows none for an AccountAdmin invitation', async () => {
    const { useCase, propertyNames } = setup(
      [
        row({ id: 'inv-pm', propertyIds: ['prop-live', 'prop-deleted'] }),
        row({ id: 'inv-admin', role: 'owner', propertyIds: ['prop-live'] }),
      ],
      [{ id: 'prop-live', name: 'Hotel Live' }],
    )

    const result = await useCase(
      undefined,
      buildTestAuthContext({ role: 'AccountAdmin' }),
    )

    expect(propertyNames).toHaveBeenCalledTimes(1)
    expect(result.invitations.map((inv) => [inv.id, inv.role, inv.properties])).toEqual([
      ['inv-pm', 'PropertyManager', [{ id: 'prop-live', name: 'Hotel Live' }]],
      ['inv-admin', 'AccountAdmin', []],
    ])
  })

  it('keeps a legacy non-beta role visible by its raw token', async () => {
    const { useCase } = setup([row({ role: 'member' })])

    const result = await useCase(
      undefined,
      buildTestAuthContext({ role: 'AccountAdmin' }),
    )

    expect(result.invitations[0]).toMatchObject({ role: null, rawRole: 'member' })
  })

  it('rejects PropertyManager from listing invitations', async () => {
    const { useCase, listOpenForOrganization } = setup([row({})])

    await expect(
      useCase(undefined, buildTestAuthContext({ role: 'PropertyManager' })),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
    expect(listOpenForOrganization).not.toHaveBeenCalled()
  })

  it('rejects Member from listing invitations', async () => {
    const { useCase, listOpenForOrganization } = setup([row({})])

    await expect(
      useCase(undefined, buildTestAuthContext({ role: 'Member' })),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
    expect(listOpenForOrganization).not.toHaveBeenCalled()
  })
})
