import { describe, expect, it, vi } from 'vitest'
import { invitationId, organizationId } from '#/shared/domain/ids'
import type {
  PlatformOrganizationRow,
  PlatformOrganizationStore,
} from './platform-organization-store.port.server'
import { listPlatformOrganizations } from './list-platform-organizations.server'

const NOW = new Date('2026-09-30T12:00:00.000Z')

const row = (id: string, accountAdminCount: number): PlatformOrganizationRow => ({
  id: organizationId(id),
  name: `Org ${id}`,
  slug: id,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  memberCount: accountAdminCount,
  accountAdminCount,
  pendingInvitationCount: 1,
  adminInvitations: [
    {
      id: invitationId(`inv-${id}`),
      email: `admin@${id}.example`,
      status: 'pending',
      expiresAt: new Date('2026-10-05T00:00:00.000Z'),
    },
  ],
})

describe('listPlatformOrganizations', () => {
  it('lists at most 200 Organizations as views', async () => {
    const store = {
      listOrganizations: vi.fn(async () => [row('org-dark', 0), row('org-lit', 2)]),
      readAdministration: vi.fn(),
      provisionOrganization: vi.fn(),
      inviteAdmin: vi.fn(),
      renewAdminInvitation: vi.fn(),
      cancelAdminInvitation: vi.fn(),
    } satisfies PlatformOrganizationStore
    const list = listPlatformOrganizations({
      store,
      clock: () => NOW,
    })

    const views = await list()

    expect(store.listOrganizations).toHaveBeenCalledWith({ limit: 200, now: NOW })
    expect(views.map((view) => view.id)).toEqual(['org-dark', 'org-lit'])
    expect(views[0]?.pendingAdminInvitations).toHaveLength(1)
    expect(views[1]?.pendingAdminInvitations).toEqual([])
  })
})
