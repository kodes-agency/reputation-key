// Identity context — delete custom role use case tests (ADR 0001).

import { describe, it, expect, vi } from 'vitest'
import { deleteCustomRole } from './delete-custom-role'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import type { IdentityPort } from '../ports/identity.port'
import type { DeleteCustomRoleInput } from '../dto/custom-role.dto'

const mockIdentity = () =>
  ({
    deleteCustomRole: vi.fn().mockResolvedValue(undefined),
  }) as unknown as IdentityPort & { deleteCustomRole: ReturnType<typeof vi.fn> }

describe('deleteCustomRole', () => {
  it('rejects when the caller lacks member.update', async () => {
    const identity = mockIdentity()
    const useCase = deleteCustomRole({ identity })
    const ctx = buildTestAuthContext({ effectivePermissions: new Set() })

    await expect(
      useCase({ role: 'content-manager' } as DeleteCustomRoleInput, ctx),
    ).rejects.toSatisfy((e: unknown) => isIdentityError(e) && e.code === 'forbidden')
    expect(identity.deleteCustomRole).not.toHaveBeenCalled()
  })

  it('deletes the role when authorized', async () => {
    const identity = mockIdentity()
    const useCase = deleteCustomRole({ identity })
    const ctx = buildTestAuthContext({
      effectivePermissions: new Set(['member.update']),
      scopeByPermission: new Map([['member.update', 'organization']]),
    })

    await useCase({ role: 'content-manager' } as DeleteCustomRoleInput, ctx)

    expect(identity.deleteCustomRole).toHaveBeenCalledWith(ctx, 'content-manager')
  })
})
