// Portal context — listPortalGroupHistory use case tests

import { describe, expect, it, vi } from 'vitest'
import {
  listPortalGroupHistory,
  PORTAL_GROUP_HISTORY_PAGE,
} from './list-portal-group-history'
import { createInMemoryPortalGroupRepo } from '#/shared/testing/in-memory-portal-group-repo'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { PortalGroupHistoryEntry } from '../../domain/portal-group-history'
import type { PortalGroup } from '../../domain/types'
import { portalGroupId, propertyId, type PropertyId } from '#/shared/domain/ids'
import type { Permission } from '#/shared/domain/permissions'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'

const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
const GROUP = portalGroupId('6f000000-0000-4000-8000-000000000001')
const AT = new Date('2026-09-30T10:00:00.000Z')

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

function setup(accessible: ReadonlyArray<PropertyId> | null = null) {
  const ctx = buildTestAuthContext({ role: 'PropertyManager' })
  const portalGroupRepo = createInMemoryPortalGroupRepo()
  const group: PortalGroup = {
    id: GROUP,
    organizationId: ctx.organizationId,
    propertyId: PROPERTY,
    name: 'Lobby',
    sortKey: null,
    createdBy: null,
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
  }
  portalGroupRepo.seed([group])
  const entry: PortalGroupHistoryEntry = {
    id: 'h1',
    organizationId: ctx.organizationId,
    propertyId: PROPERTY,
    portalGroupId: GROUP,
    kind: 'created',
    portalId: null,
    otherGroupId: null,
    name: 'Lobby',
    previousName: null,
    actorUserId: ctx.userId,
    occurredAt: AT,
  }
  const listForGroup = vi.fn(async () => [entry])
  const useCase = listPortalGroupHistory({
    portalGroupRepo,
    portalGroupHistoryRepo: { listForGroup },
    staffPublicApi: staffApi(accessible),
  })
  return { useCase, ctx, listForGroup, entry }
}

const codeOf = (error: unknown): string | undefined =>
  isPortalError(error) ? error.code : undefined

describe('listPortalGroupHistory', () => {
  it('returns the ledger of a group, one page', async () => {
    const { useCase, ctx, listForGroup, entry } = setup()

    const result = await useCase({ portalGroupId: GROUP }, ctx)

    expect(result).toEqual([entry])
    expect(listForGroup).toHaveBeenCalledWith(
      ctx.organizationId,
      GROUP,
      PORTAL_GROUP_HISTORY_PAGE,
    )
  })

  it('refuses a role that cannot read Portals', async () => {
    const { useCase, listForGroup } = setup()

    await expect(
      useCase(
        { portalGroupId: GROUP },
        buildTestAuthContext({
          role: 'Member',
          effectivePermissions: new Set<Permission>(['dashboard.read']),
        }),
      ),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')
    expect(listForGroup).not.toHaveBeenCalled()
  })

  it('refuses a group that is not in the Organization', async () => {
    const { useCase, ctx, listForGroup } = setup()

    await expect(useCase({ portalGroupId: 'missing-group' }, ctx)).rejects.toSatisfy(
      (e: unknown) => codeOf(e) === 'group_not_found',
    )
    expect(listForGroup).not.toHaveBeenCalled()
  })

  it('refuses a manager who is not assigned to the group Property', async () => {
    const { useCase, ctx, listForGroup } = setup([])

    await expect(useCase({ portalGroupId: GROUP }, ctx)).rejects.toSatisfy(
      (e: unknown) => codeOf(e) === 'forbidden',
    )
    expect(listForGroup).not.toHaveBeenCalled()
  })
})
