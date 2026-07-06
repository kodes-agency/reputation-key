import { describe, it, expect } from 'vitest'
import { getOrgActivity } from './get-org-activity'
import type { ActivityLog } from '../domain/types'
import type { ActivityRepository } from '../ports/activity-repository.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'
import { activityLogId, userId, propertyId, organizationId } from '#/shared/domain/ids'

function makeEntry(overrides: Partial<ActivityLog> = {}): ActivityLog {
  return {
    id: activityLogId('al-1'),
    actorId: userId('user-1'),
    actorName: 'Test',
    actorAvatarUrl: null,
    actorRole: 'Staff' as Role,
    action: 'created',
    resourceType: 'inbox_item',
    resourceId: 'ii-1',
    propertyId: null,
    organizationId: organizationId('org-1'),
    payload: { subject: 'test', from: null, to: null, detail: null },
    source: 'web',
    eventId: 'test-event-id',
    createdAt: new Date(),
    ...overrides,
  }
}

/** In-memory repo: returns the seeded entries, honouring the propertyIds filter
 *  so the SQL-pushed property scoping (ACT-010) is exercised. */
function createInMemoryActivityRepo(entries: ActivityLog[]): ActivityRepository {
  return {
    insert: async () => {},
    findDuplicate: async () => false,
    findByResource: async () => entries,
    findByOrganization: async (_orgId, filter) => {
      const ids = filter.propertyIds?.map((p) => p as string)
      if (ids && ids.length > 0) {
        return entries.filter(
          (e) => e.propertyId === null || ids.includes(e.propertyId as string),
        )
      }
      if (filter.propertyId) {
        return entries.filter(
          (e) =>
            e.propertyId === null ||
            (e.propertyId as string) === (filter.propertyId as string),
        )
      }
      return entries
    },
  }
}

function staffApiAllAccess(): StaffPublicApi {
  return {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
    countAssignmentsByTeam: async () => 0,
  }
}

function staffApiLimited(ids: string[]): StaffPublicApi {
  return {
    getAccessiblePropertyIds: async () => ids.map(propertyId),
    getAssignedPortals: async () => [],
    countAssignmentsByTeam: async () => 0,
  }
}

describe('getOrgActivity', () => {
  const baseInput = {
    organizationId: organizationId('org-1'),
    userId: userId('user-1'),
    role: 'Staff' as Role,
  }

  it('returns reply entries for AccountAdmin (has reply.manage)', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({ id: activityLogId('al-1'), resourceType: 'inbox_item' }),
      makeEntry({
        id: activityLogId('al-2'),
        resourceType: 'reply',
        action: 'published',
      }),
    ])
    const deps = { repo, staffPublicApi: staffApiAllAccess() }
    const result = await getOrgActivity(deps)({
      ...baseInput,
      role: 'AccountAdmin' as Role,
    })
    expect(result.map((e) => e.id).sort()).toEqual(['al-1', 'al-2'])
  })

  it('strips reply-workflow entries from Staff (lacks reply.manage)', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({ id: activityLogId('al-1'), resourceType: 'inbox_item' }),
      makeEntry({
        id: activityLogId('al-2'),
        resourceType: 'reply',
        action: 'rejected',
        payload: {
          subject: 'reply',
          from: null,
          to: null,
          detail: 'rejected: contained PII',
        },
      }),
    ])
    const deps = { repo, staffPublicApi: staffApiLimited(['prop-1']) }
    const result = await getOrgActivity(deps)({ ...baseInput, role: 'Staff' })
    // The reply row (carrying the rejection reason) must not surface to Staff.
    expect(result.map((e) => e.id)).toEqual(['al-1'])
  })

  it('keeps reply entries for PropertyManager (has reply.manage)', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({ id: activityLogId('al-1'), resourceType: 'inbox_item' }),
      makeEntry({
        id: activityLogId('al-2'),
        resourceType: 'reply',
        action: 'published',
      }),
    ])
    const deps = { repo, staffPublicApi: staffApiAllAccess() }
    const result = await getOrgActivity(deps)({
      ...baseInput,
      role: 'PropertyManager' as Role,
    })
    expect(result.map((e) => e.id).sort()).toEqual(['al-1', 'al-2'])
  })

  it('scopes Staff to accessible properties AND strips replies', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({
        id: activityLogId('al-1'),
        resourceType: 'inbox_item',
        propertyId: propertyId('prop-1'),
      }),
      makeEntry({
        id: activityLogId('al-2'),
        resourceType: 'reply',
        action: 'published',
        propertyId: propertyId('prop-1'),
      }),
      makeEntry({
        id: activityLogId('al-3'),
        resourceType: 'inbox_item',
        propertyId: propertyId('prop-2'),
      }),
    ])
    const deps = { repo, staffPublicApi: staffApiLimited(['prop-1']) }
    const result = await getOrgActivity(deps)({ ...baseInput, role: 'Staff' })
    // prop-1 inbox_item kept; prop-1 reply stripped; prop-2 out of scope.
    expect(result.map((e) => e.id)).toEqual(['al-1'])
  })

  it('returns empty when Staff has no accessible properties', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({ id: activityLogId('al-1'), resourceType: 'inbox_item' }),
    ])
    const deps = { repo, staffPublicApi: staffApiLimited([]) }
    const result = await getOrgActivity(deps)({ ...baseInput, role: 'Staff' })
    expect(result).toHaveLength(0)
  })
})
