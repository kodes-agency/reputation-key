import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, userId } from './ids'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import {
  getAccessiblePropertyIdsForPermission,
  isPropertyAccessibleForPermission,
} from './property-access'

describe('property access by permission scope', () => {
  it('fails closed for a none-scoped permission without consulting assignments', async () => {
    const lookup = vi.fn(async () => [propertyId('property-1')])
    const ctx = createScopedAuthContext({
      organizationId: organizationId('organization-1'),
      userId: userId('user-1'),
      permissions: [['feedback.read', 'none']],
    })

    await expect(
      isPropertyAccessibleForPermission(
        lookup,
        ctx,
        'feedback.read',
        propertyId('property-1'),
      ),
    ).resolves.toBe(false)
    await expect(
      getAccessiblePropertyIdsForPermission(lookup, ctx, 'feedback.read'),
    ).resolves.toEqual([])
    expect(lookup).not.toHaveBeenCalled()
  })
})
