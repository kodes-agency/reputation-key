import { describe, expect, it, vi } from 'vitest'
import { invitationId, organizationId } from '#/shared/domain/ids'
import type {
  PlatformOrganizationRow,
  PlatformOrganizationStore,
} from '../ports/platform-organization-store.port'
import { listPlatformOrganizations } from './list-platform-organizations'

const NOW = new Date('2026-09-30T12:00:00.000Z')

const row = (id: string, accountAdminCount: number): PlatformOrganizationRow => ({
  id: organizationId(id),
  name: `Org ${id}`,
  slug: id,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  lifecycleState: 'active',
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
  it('lists at most 200 Organizations as views, with controlled-beta coverage', async () => {
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
      isControlledBetaEnabled: (id) => id === 'org-lit',
      clock: () => NOW,
    })

    const views = await list()

    expect(store.listOrganizations).toHaveBeenCalledWith({ limit: 200, now: NOW })
    expect(views.map((view) => [view.id, view.controlledBetaEnabled])).toEqual([
      ['org-dark', false],
      ['org-lit', true],
    ])
    expect(views[0]?.pendingAdminInvitations).toHaveLength(1)
    expect(views[1]?.pendingAdminInvitations).toEqual([])
  })
})
