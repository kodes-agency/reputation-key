// Identity context — create custom role use case tests (ADR 0001).
// Escalation logic is tested with explicit effectivePermissions/scopeByPermission on the
// context, so the assertions don't depend on the static role permission table.

import { describe, it, expect, vi } from 'vitest'
import { createCustomRole } from './create-custom-role'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import type { IdentityPort } from '../ports/identity.port'
import type { Permission } from '#/shared/domain/permissions'
import type { DataScope } from '#/shared/domain/data-scope'
import type { CreateCustomRoleInput } from '../dto/custom-role.dto'

const mockIdentity = () =>
  ({
    createCustomRole: vi.fn().mockResolvedValue(undefined),
  }) as unknown as IdentityPort & {
    createCustomRole: ReturnType<typeof vi.fn>
  }

/** Build a ctx whose dynamic fields grant `perms` each at `scope` (+ member.update@org). */
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
): CreateCustomRoleInput =>
  ({
    role: 'content-manager',
    permissions: ['property.read'],
    dataScope: 'organization',
    ...overrides,
  }) as CreateCustomRoleInput

describe('createCustomRole', () => {
  it('rejects when the caller lacks member.update', async () => {
    const identity = mockIdentity()
    const useCase = createCustomRole({ identity })
    const ctx = buildTestAuthContext({ effectivePermissions: new Set() })

    await expect(useCase(makeInput(), ctx)).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'forbidden',
    )
    expect(identity.createCustomRole).not.toHaveBeenCalled()
  })

  it('rejects when granting a permission the caller does not hold', async () => {
    const identity = mockIdentity()
    const useCase = createCustomRole({ identity })

    await expect(
      useCase(
        makeInput({ permissions: ['property.update'] }),
        ctxWith(['property.read']),
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIdentityError(e) &&
        e.code === 'forbidden' &&
        e.message.includes('property.update'),
    )
    expect(identity.createCustomRole).not.toHaveBeenCalled()
  })

  it('rejects when the role scope is broader than the caller scope for a permission', async () => {
    const identity = mockIdentity()
    const useCase = createCustomRole({ identity })

    // Caller holds property.read at assigned-properties; role wants it at organization.
    await expect(
      useCase(
        makeInput({ permissions: ['property.read'], dataScope: 'organization' }),
        ctxWith(['property.read'], 'assigned-properties'),
      ),
    ).rejects.toSatisfy((e: unknown) => isIdentityError(e) && e.code === 'forbidden')
    expect(identity.createCustomRole).not.toHaveBeenCalled()
  })

  it('creates the role when the escalation checks pass', async () => {
    const identity = mockIdentity()
    const useCase = createCustomRole({ identity })

    await useCase(
      makeInput({
        permissions: ['property.read', 'property.update'],
        dataScope: 'organization',
      }),
      ctxWith(['property.read', 'property.update'], 'organization'),
    )

    expect(identity.createCustomRole).toHaveBeenCalledTimes(1)
    expect(identity.createCustomRole).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        role: 'content-manager',
        permissions: ['property.read', 'property.update'],
        dataScope: 'organization',
      }),
    )
  })
})
