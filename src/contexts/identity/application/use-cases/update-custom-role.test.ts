// Identity context — update custom role use case tests (ADR 0001).

import { describe, it, expect, vi } from 'vitest'
import { updateCustomRole } from './update-custom-role'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import type { IdentityPort } from '../ports/identity.port'
import type { Permission } from '#/shared/domain/permissions'
import type { DataScope } from '#/shared/domain/data-scope'
import type { UpdateCustomRoleInput } from '../dto/custom-role.dto'

const mockIdentity = () =>
  ({
    updateCustomRole: vi.fn().mockResolvedValue(undefined),
  }) as unknown as IdentityPort & { updateCustomRole: ReturnType<typeof vi.fn> }

const ctxWith = (perms: ReadonlyArray<Permission>, scope: DataScope = 'organization') => {
  const held = ['member.update' as Permission, ...perms]
  return buildTestAuthContext({
    effectivePermissions: new Set(held),
    scopeByPermission: new Map(
      held.map((p) => [p, p === 'member.update' ? 'organization' : scope]),
    ),
  })
}

const makeInput = (
  overrides: Partial<{ role: string; permissions: string[]; dataScope: DataScope }> = {},
): UpdateCustomRoleInput =>
  ({
    role: 'content-manager',
    permissions: ['property.read'],
    dataScope: 'organization',
    ...overrides,
  }) as UpdateCustomRoleInput

describe('updateCustomRole', () => {
  it('rejects when the caller lacks member.update', async () => {
    const identity = mockIdentity()
    const useCase = updateCustomRole({ identity })
    const ctx = buildTestAuthContext({ effectivePermissions: new Set() })

    await expect(useCase(makeInput(), ctx)).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'forbidden',
    )
    expect(identity.updateCustomRole).not.toHaveBeenCalled()
  })

  it('rejects escalation to a permission the caller does not hold', async () => {
    const identity = mockIdentity()
    const useCase = updateCustomRole({ identity })

    await expect(
      useCase(
        makeInput({ permissions: ['property.update'] }),
        ctxWith(['property.read']),
      ),
    ).rejects.toSatisfy((e: unknown) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('updates the role when the escalation checks pass', async () => {
    const identity = mockIdentity()
    const useCase = updateCustomRole({ identity })

    await useCase(
      makeInput({
        permissions: ['property.read', 'property.update'],
        dataScope: 'organization',
      }),
      ctxWith(['property.read', 'property.update'], 'organization'),
    )

    expect(identity.updateCustomRole).toHaveBeenCalledWith(
      expect.anything(),
      'content-manager',
      expect.objectContaining({
        permissions: ['property.read', 'property.update'],
        dataScope: 'organization',
      }),
    )
  })
})
