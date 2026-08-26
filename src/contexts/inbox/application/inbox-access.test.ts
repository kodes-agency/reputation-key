import { describe, expect, it } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { organizationId, userId } from '#/shared/domain/ids'
import { propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import {
  assertInboxSourcePropertyAccessible,
  canHandleInboxSource,
  canReadInboxSource,
  readableInboxSourceTypes,
  resolveInboxSourceScopes,
} from './inbox-access'

const contextWith = (...permissions: Permission[]): AuthContext => ({
  organizationId: organizationId('org-1'),
  userId: userId('user-1'),
  role: 'Staff',
  effectivePermissions: new Set(permissions),
  scopeByPermission: new Map(
    permissions.map((permission) => [permission, 'assigned-properties' as const]),
  ),
})

describe('Inbox source-specific access', () => {
  it('requires Inbox read and Review read for Review visibility', () => {
    expect(canReadInboxSource(contextWith('inbox.read'), 'review')).toBe(false)
    expect(canReadInboxSource(contextWith('review.read'), 'review')).toBe(false)
    expect(canReadInboxSource(contextWith('inbox.read', 'review.read'), 'review')).toBe(
      true,
    )
  })

  it('requires Inbox read and Feedback read for private-feedback visibility', () => {
    expect(canReadInboxSource(contextWith('inbox.read'), 'feedback')).toBe(false)
    expect(canReadInboxSource(contextWith('feedback.read'), 'feedback')).toBe(false)
    expect(
      canReadInboxSource(contextWith('inbox.read', 'feedback.read'), 'feedback'),
    ).toBe(true)
  })

  it('uses a separate Feedback handling permission for private-feedback work', () => {
    expect(
      canHandleInboxSource(contextWith('inbox.write', 'feedback.read'), 'feedback'),
    ).toBe(false)
    expect(
      canHandleInboxSource(contextWith('inbox.write', 'feedback.handle'), 'feedback'),
    ).toBe(true)
  })

  it('returns only the source families the caller may read', () => {
    expect(readableInboxSourceTypes(contextWith('inbox.read', 'review.read'))).toEqual([
      'review',
    ])
    expect(
      readableInboxSourceTypes(contextWith('inbox.read', 'review.read', 'feedback.read')),
    ).toEqual(['review', 'feedback'])
    expect(readableInboxSourceTypes(contextWith('inbox.read'))).toEqual([])
  })

  it('intersects Inbox and owning-context property scopes per source', async () => {
    const staffPublicApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('property-1')],
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    }
    const ctx = createScopedAuthContext({
      organizationId: organizationId('org-1'),
      userId: userId('user-1'),
      permissions: [
        ['inbox.read', 'organization'],
        ['review.read', 'organization'],
        ['feedback.read', 'assigned-properties'],
      ],
    })

    await expect(resolveInboxSourceScopes(staffPublicApi, ctx, 'read')).resolves.toEqual([
      { sourceType: 'review' },
      { sourceType: 'feedback', propertyIds: [propertyId('property-1')] },
    ])
  })

  it('treats a none-scoped owning permission as no source visibility', async () => {
    const staffPublicApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('property-1')],
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    }
    const ctx = createScopedAuthContext({
      organizationId: organizationId('org-1'),
      userId: userId('user-1'),
      permissions: [
        ['inbox.read', 'organization'],
        ['feedback.read', 'none'],
      ],
    })

    await expect(resolveInboxSourceScopes(staffPublicApi, ctx, 'read')).resolves.toEqual(
      [],
    )
    await expect(
      assertInboxSourcePropertyAccessible(
        staffPublicApi,
        ctx,
        'read',
        'feedback',
        propertyId('property-1'),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
