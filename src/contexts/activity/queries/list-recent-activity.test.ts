import { describe, it, expect } from 'vitest'
import { listRecentActivity } from './list-recent-activity'
import type { RecentActivityEntry } from '../domain/types'
import type { RecentActivityRepository } from '../ports/recent-activity-repository.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'
import {
  recentActivityEntryId,
  userId,
  propertyId,
  organizationId,
} from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'

function makeEntry(overrides: Partial<RecentActivityEntry> = {}): RecentActivityEntry {
  return {
    id: recentActivityEntryId('al-1'),
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
function createInMemoryActivityRepo(
  entries: RecentActivityEntry[],
): RecentActivityRepository {
  return {
    insert: async () => {},
    findDuplicate: async () => false,
    findByResource: async () => entries,
    findByOrganization: async (_orgId, filter) => {
      const ids = filter.propertyIds?.map((p) => p as string)
      if (ids && ids.length > 0) {
        return entries.filter(
          (e) => e.propertyId !== null && ids.includes(e.propertyId as string),
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
  }
}

function staffApiLimited(ids: string[]): StaffPublicApi {
  return {
    getAccessiblePropertyIds: async () => ids.map(propertyId),
    getAssignedPortals: async () => [],
  }
}

describe('listRecentActivity', () => {
  const ORG_ID = organizationId('org-1')
  const USER_ID = userId('user-1')
  const ctxFor = (role: Role) =>
    ({ organizationId: ORG_ID, userId: USER_ID, role }) as AuthContext

  it('returns reply entries for AccountAdmin (has reply.manage)', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({ id: recentActivityEntryId('al-1'), resourceType: 'inbox_item' }),
      makeEntry({
        id: recentActivityEntryId('al-2'),
        resourceType: 'reply',
        action: 'published',
      }),
    ])
    const deps = { repo, staffPublicApi: staffApiAllAccess() }
    const result = await listRecentActivity(deps)({}, ctxFor('AccountAdmin'))
    expect(result.map((e) => e.id).sort()).toEqual(['al-1', 'al-2'])
  })

  it('strips reply-workflow entries from Staff (lacks reply.manage)', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({
        id: recentActivityEntryId('al-1'),
        resourceType: 'inbox_item',
        propertyId: propertyId('prop-1'),
      }),
      makeEntry({
        id: recentActivityEntryId('al-2'),
        resourceType: 'reply',
        action: 'rejected',
        propertyId: propertyId('prop-1'),
        payload: {
          subject: 'reply',
          from: null,
          to: null,
          detail: 'rejected: contained PII',
        },
      }),
    ])
    const deps = { repo, staffPublicApi: staffApiLimited(['prop-1']) }
    const result = await listRecentActivity(deps)({}, ctxFor('Staff'))
    // The reply row (carrying the rejection reason) must not surface to Staff.
    expect(result.map((e) => e.id)).toEqual(['al-1'])
  })

  it('keeps reply entries for PropertyManager only inside current Property access', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({
        id: recentActivityEntryId('al-1'),
        resourceType: 'inbox_item',
        propertyId: propertyId('prop-1'),
      }),
      makeEntry({
        id: recentActivityEntryId('al-2'),
        resourceType: 'reply',
        action: 'published',
        propertyId: propertyId('prop-1'),
      }),
      makeEntry({
        id: recentActivityEntryId('al-3'),
        resourceType: 'reply',
        action: 'published',
        propertyId: propertyId('prop-2'),
      }),
    ])
    const deps = { repo, staffPublicApi: staffApiLimited(['prop-1']) }
    const result = await listRecentActivity(deps)({}, ctxFor('PropertyManager'))
    expect(result.map((e) => e.id).sort()).toEqual(['al-1', 'al-2'])
  })

  it('does not expose Organization-scoped entries to assigned-Property readers', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({
        id: recentActivityEntryId('al-1'),
        resourceType: 'organization',
        resourceId: 'org-1',
        propertyId: null,
      }),
      makeEntry({
        id: recentActivityEntryId('al-2'),
        propertyId: propertyId('prop-1'),
      }),
    ])
    const deps = { repo, staffPublicApi: staffApiLimited(['prop-1']) }

    const result = await listRecentActivity(deps)({}, ctxFor('PropertyManager'))

    expect(result.map((entry) => entry.id)).toEqual(['al-2'])
  })

  it('fails closed if assigned-scope authority returns an organization sentinel', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({ id: recentActivityEntryId('al-1'), propertyId: propertyId('prop-1') }),
    ])
    const deps = { repo, staffPublicApi: staffApiAllAccess() }

    await expect(
      listRecentActivity(deps)({}, ctxFor('PropertyManager')),
    ).resolves.toEqual([])
  })

  it('rejects an explicitly requested Property outside current access', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({ id: recentActivityEntryId('al-1'), propertyId: propertyId('prop-2') }),
    ])
    const deps = { repo, staffPublicApi: staffApiLimited(['prop-1']) }

    await expect(
      listRecentActivity(deps)(
        { propertyId: propertyId('prop-2') },
        ctxFor('PropertyManager'),
      ),
    ).resolves.toEqual([])
  })

  it('scopes Staff to accessible properties AND strips replies', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({
        id: recentActivityEntryId('al-1'),
        resourceType: 'inbox_item',
        propertyId: propertyId('prop-1'),
      }),
      makeEntry({
        id: recentActivityEntryId('al-2'),
        resourceType: 'reply',
        action: 'published',
        propertyId: propertyId('prop-1'),
      }),
      makeEntry({
        id: recentActivityEntryId('al-3'),
        resourceType: 'inbox_item',
        propertyId: propertyId('prop-2'),
      }),
    ])
    const deps = { repo, staffPublicApi: staffApiLimited(['prop-1']) }
    const result = await listRecentActivity(deps)({}, ctxFor('Staff'))
    // prop-1 inbox_item kept; prop-1 reply stripped; prop-2 out of scope.
    expect(result.map((e) => e.id)).toEqual(['al-1'])
  })

  it('returns empty when Staff has no accessible properties', async () => {
    const repo = createInMemoryActivityRepo([
      makeEntry({ id: recentActivityEntryId('al-1'), resourceType: 'inbox_item' }),
    ])
    const deps = { repo, staffPublicApi: staffApiLimited([]) }
    const result = await listRecentActivity(deps)({}, ctxFor('Staff'))
    expect(result).toHaveLength(0)
  })

  // BQC-4.4: tenant-authored detail text lives in the cell DB and is shown
  // ONLY to members of the owning org — the read is always org-scoped.
  it('queries only the caller org (org-scope pin)', async () => {
    const seenOrgs: string[] = []
    const repo: RecentActivityRepository = {
      insert: async () => {},
      findDuplicate: async () => false,
      findByResource: async () => [],
      findByOrganization: async (orgId) => {
        seenOrgs.push(orgId as string)
        // Mirror the SQL WHERE organization_id = orgId: rows from another
        // org cannot be returned by the owning-org read.
        return [
          makeEntry({
            id: recentActivityEntryId('al-1'),
            organizationId: organizationId('org-1'),
          }),
          makeEntry({
            id: recentActivityEntryId('al-2'),
            organizationId: organizationId('org-2'),
            payload: {
              subject: 's',
              from: null,
              to: null,
              detail: 'other-org free text',
            },
          }),
        ].filter((e) => (e.organizationId as string) === (orgId as string))
      },
    }
    const deps = { repo, staffPublicApi: staffApiAllAccess() }
    const result = await listRecentActivity(deps)({}, ctxFor('AccountAdmin'))
    expect(seenOrgs).toEqual(['org-1'])
    expect(result.map((e) => e.id)).toEqual(['al-1'])
  })
})
