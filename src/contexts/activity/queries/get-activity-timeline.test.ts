import { describe, it, expect } from 'vitest'
import { getActivityTimeline } from './get-activity-timeline'
import type { ActivityLog } from '../domain/types'
import type { ActivityRepository } from '../ports/activity-repository.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'
import { activityLogId, userId, propertyId, organizationId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'

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

function createInMemoryActivityRepo(entries: ActivityLog[] = []): ActivityRepository {
  return {
    insert: async (_entry) => {},
    findDuplicate: async () => false,
    findByResource: async (_orgId, _rt, _rid, limit) => entries.slice(0, limit),
    findByOrganization: async (_orgId, _filter, _pagination) => entries,
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

describe('getActivityTimeline', () => {
  const ORG_ID = organizationId('org-1')
  const USER_ID = userId('user-1')
  const ctxFor = (role: Role) =>
    ({ organizationId: ORG_ID, userId: USER_ID, role }) as AuthContext
  const baseInput = {
    resourceType: 'inbox_item',
    resourceId: 'ii-1',
  }

  it('returns all entries for admin users', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry(),
      makeEntry({ id: activityLogId('al-2'), propertyId: propertyId('prop-2') }),
    ])
    const deps = { repo, staffPublicApi: staffApiAllAccess() }
    const result = await getActivityTimeline(deps)(baseInput, ctxFor('AccountAdmin'))
    expect(result).toHaveLength(2)
  })

  it('filters entries by accessible properties for non-admin', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({ id: activityLogId('al-1'), propertyId: propertyId('prop-1') }),
      makeEntry({ id: activityLogId('al-2'), propertyId: propertyId('prop-2') }),
      makeEntry({ id: activityLogId('al-3'), propertyId: null }),
    ])
    const deps = { repo, staffPublicApi: staffApiLimited(['prop-1']) }
    const result = await getActivityTimeline(deps)(baseInput, ctxFor('Staff'))
    expect(result.map((e) => e.id).sort()).toEqual(['al-1', 'al-3'])
  })

  it('returns empty when staff has no accessible properties', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({ id: activityLogId('al-1'), propertyId: propertyId('prop-1') }),
      makeEntry({ id: activityLogId('al-2'), propertyId: propertyId('prop-2') }),
    ])
    const deps = { repo, staffPublicApi: staffApiLimited([]) }
    const result = await getActivityTimeline(deps)(baseInput, ctxFor('Staff'))
    expect(result).toHaveLength(0)
  })

  it('respects limit parameter', async () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ id: activityLogId(`al-${i}`) }),
    )
    const repo = createInMemoryActivityRepo(entries)
    const deps = { repo, staffPublicApi: staffApiAllAccess() }
    const result = await getActivityTimeline(deps)(
      { ...baseInput, limit: 3 },
      ctxFor('AccountAdmin'),
    )
    expect(result).toHaveLength(3)
  })

  it('strips reply-workflow entries from Staff (lacks reply.manage)', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({ id: activityLogId('al-1'), resourceType: 'inbox_item' }),
      makeEntry({
        id: activityLogId('al-2'),
        resourceType: 'reply',
        action: 'published',
      }),
      makeEntry({
        id: activityLogId('al-3'),
        resourceType: 'reply',
        action: 'rejected',
        payload: {
          subject: 'reply',
          from: null,
          to: null,
          detail: 'contained a customer name',
        },
      }),
    ])
    const deps = { repo, staffPublicApi: staffApiAllAccess() }
    const result = await getActivityTimeline(deps)(baseInput, ctxFor('Staff'))
    // Only the inbox_item entry survives; reply rows (incl. rejection reason)
    // are stripped because Staff lack reply.manage.
    expect(result.map((e) => e.id)).toEqual(['al-1'])
  })

  it('keeps reply-workflow entries for PropertyManager (has reply.manage)', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({ id: activityLogId('al-1'), resourceType: 'inbox_item' }),
      makeEntry({
        id: activityLogId('al-2'),
        resourceType: 'reply',
        action: 'published',
      }),
    ])
    const deps = { repo, staffPublicApi: staffApiAllAccess() }
    const result = await getActivityTimeline(deps)(baseInput, ctxFor('PropertyManager'))
    expect(result.map((e) => e.id).sort()).toEqual(['al-1', 'al-2'])
  })
})
