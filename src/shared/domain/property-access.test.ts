import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, userId } from './ids'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import {
  getAccessiblePropertyIdsForPermission,
  isPropertyAccessible,
  isPropertyAccessibleForPermission,
  mayUsePermissionOnProperties,
} from './property-access'

const ORGANIZATION_ID = organizationId('organization-1')
const USER_ID = userId('user-1')
const ASSIGNED_PROPERTY_ID = propertyId('property-1')
const OTHER_PROPERTY_ID = propertyId('property-2')

describe('property access by permission scope', () => {
  it('fails closed for a none-scoped permission without consulting assignments', async () => {
    const lookup = vi.fn(async () => [propertyId('property-1')])
    const ctx = createScopedAuthContext({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      permissions: [['feedback.read', 'none']],
    })

    await expect(
      isPropertyAccessibleForPermission(
        lookup,
        ctx,
        'feedback.read',
        ASSIGNED_PROPERTY_ID,
      ),
    ).resolves.toBe(false)
    await expect(
      getAccessiblePropertyIdsForPermission(lookup, ctx, 'feedback.read'),
    ).resolves.toEqual([])
    expect(lookup).not.toHaveBeenCalled()
  })

  it('admits organization-scoped access without consulting assignments', async () => {
    const lookup = vi.fn(async () => [OTHER_PROPERTY_ID])
    const ctx = createScopedAuthContext({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      permissions: [['feedback.read', 'organization']],
    })

    await expect(
      isPropertyAccessibleForPermission(
        lookup,
        ctx,
        'feedback.read',
        ASSIGNED_PROPERTY_ID,
      ),
    ).resolves.toBe(true)
    await expect(
      getAccessiblePropertyIdsForPermission(lookup, ctx, 'feedback.read'),
    ).resolves.toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('uses only the governing permission assignment set for property-scoped access', async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([ASSIGNED_PROPERTY_ID])
      .mockResolvedValueOnce([ASSIGNED_PROPERTY_ID])
      .mockResolvedValueOnce([ASSIGNED_PROPERTY_ID])
    const ctx = createScopedAuthContext({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      permissions: [['feedback.read', 'assigned-properties']],
    })

    await expect(
      isPropertyAccessibleForPermission(
        lookup,
        ctx,
        'feedback.read',
        ASSIGNED_PROPERTY_ID,
      ),
    ).resolves.toBe(true)
    await expect(
      isPropertyAccessibleForPermission(
        lookup,
        ctx,
        'feedback.read',
        ASSIGNED_PROPERTY_ID,
      ),
    ).resolves.toBe(true)
    await expect(
      isPropertyAccessibleForPermission(lookup, ctx, 'feedback.read', OTHER_PROPERTY_ID),
    ).resolves.toBe(false)
    await expect(
      getAccessiblePropertyIdsForPermission(lookup, ctx, 'feedback.read'),
    ).resolves.toEqual([ASSIGNED_PROPERTY_ID])
    expect(lookup).toHaveBeenCalledTimes(4)
    expect(lookup).toHaveBeenCalledWith(ORGANIZATION_ID, USER_ID, false)
  })
})

describe('low-level property accessibility', () => {
  it('passes the requested scope to the lookup and handles all-properties or assigned sets', async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([ASSIGNED_PROPERTY_ID])
      .mockResolvedValueOnce([ASSIGNED_PROPERTY_ID])

    await expect(
      isPropertyAccessible(lookup, ORGANIZATION_ID, USER_ID, true, OTHER_PROPERTY_ID),
    ).resolves.toBe(true)
    await expect(
      isPropertyAccessible(lookup, ORGANIZATION_ID, USER_ID, false, ASSIGNED_PROPERTY_ID),
    ).resolves.toBe(true)
    await expect(
      isPropertyAccessible(lookup, ORGANIZATION_ID, USER_ID, false, OTHER_PROPERTY_ID),
    ).resolves.toBe(false)
    expect(lookup).toHaveBeenNthCalledWith(1, ORGANIZATION_ID, USER_ID, true)
    expect(lookup).toHaveBeenNthCalledWith(2, ORGANIZATION_ID, USER_ID, false)
    expect(lookup).toHaveBeenNthCalledWith(3, ORGANIZATION_ID, USER_ID, false)
  })
})

describe('the Property decision a use case makes first', () => {
  const manager = createScopedAuthContext({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    permissions: [['dashboard.read', 'assigned-properties']],
  })
  const on = (...propertyIds: ReadonlyArray<typeof ASSIGNED_PROPERTY_ID>) => ({
    organizationId: ORGANIZATION_ID,
    propertyIds,
  })

  it('admits a manager on a granted Property and refuses an ungranted one', async () => {
    const lookup = vi.fn(async () => [ASSIGNED_PROPERTY_ID])

    await expect(
      mayUsePermissionOnProperties(
        lookup,
        manager,
        'dashboard.read',
        on(ASSIGNED_PROPERTY_ID),
      ),
    ).resolves.toBe(true)
    await expect(
      mayUsePermissionOnProperties(
        lookup,
        manager,
        'dashboard.read',
        on(OTHER_PROPERTY_ID),
      ),
    ).resolves.toBe(false)
  })

  it('refuses the whole request when one of several Properties is not granted, on one lookup', async () => {
    const lookup = vi.fn(async () => [ASSIGNED_PROPERTY_ID])

    await expect(
      mayUsePermissionOnProperties(
        lookup,
        manager,
        'dashboard.read',
        on(ASSIGNED_PROPERTY_ID, OTHER_PROPERTY_ID),
      ),
    ).resolves.toBe(false)
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('refuses a caller who does not hold the permission, without consulting grants', async () => {
    const lookup = vi.fn(async () => [ASSIGNED_PROPERTY_ID])
    const withoutDashboard = createScopedAuthContext({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      permissions: [['inbox.read', 'organization']],
    })

    await expect(
      mayUsePermissionOnProperties(
        lookup,
        withoutDashboard,
        'dashboard.read',
        on(ASSIGNED_PROPERTY_ID),
      ),
    ).resolves.toBe(false)
    expect(lookup).not.toHaveBeenCalled()
  })

  it("refuses a caller from another Organization, whatever that caller's own scope", async () => {
    const lookup = vi.fn(async () => null)
    const foreignAdmin = createScopedAuthContext({
      organizationId: organizationId('organization-2'),
      userId: USER_ID,
      permissions: [['dashboard.read', 'organization']],
    })

    await expect(
      mayUsePermissionOnProperties(
        lookup,
        foreignAdmin,
        'dashboard.read',
        on(ASSIGNED_PROPERTY_ID),
      ),
    ).resolves.toBe(false)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('admits an Organization-wide holder on every Property without consulting grants', async () => {
    const lookup = vi.fn(async () => [])
    const admin = createScopedAuthContext({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      permissions: [['dashboard.read', 'organization']],
    })

    await expect(
      mayUsePermissionOnProperties(
        lookup,
        admin,
        'dashboard.read',
        on(ASSIGNED_PROPERTY_ID, OTHER_PROPERTY_ID),
      ),
    ).resolves.toBe(true)
    expect(lookup).not.toHaveBeenCalled()
  })
})
