import { describe, expect, it, vi } from 'vitest'
import { userId } from '#/shared/domain/ids'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import type { PortalResponsibleManagerRepository } from '../ports/portal-responsible-manager.repository'
import { getPortalContactRequestManagerAuthorityFacts } from './portal-contact-request-authority'

const PORTAL = buildTestPortal({ createdBy: userId('creator-1') })

const setup = (input?: {
  activeAssignments?: readonly string[]
  eligibleManagers?: readonly string[]
}) => {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([PORTAL])
  const activeAssignments = input?.activeAssignments ?? ['manager-1', 'stale-manager']
  const managerRepo = {
    listActive: vi.fn(async () =>
      activeAssignments.map((userId, index) => ({
        id: `assignment-${index}`,
        organizationId: PORTAL.organizationId,
        propertyId: PORTAL.propertyId,
        portalId: PORTAL.id,
        userId,
        effectiveFrom: PORTAL.createdAt,
        effectiveTo: null,
        createdBy: 'creator-1',
        endReason: null,
      })),
    ),
  } as unknown as Pick<PortalResponsibleManagerRepository, 'listActive'>
  const eligibleManagers = input?.eligibleManagers ?? ['manager-1']
  const identityPublicApi = {
    listActiveManagers: vi.fn(async () =>
      eligibleManagers.map((userId) => ({
        userId,
        role: 'PropertyManager' as const,
        propertyAccessScope: 'assigned-properties' as const,
      })),
    ),
  }
  const staffPublicApi = {
    getAccessiblePropertyIds: vi.fn(async () => [PORTAL.propertyId]),
    getAssignedPortals: vi.fn(async () => []),
    findActiveParticipation: vi.fn(async () => ({}) as never),
  }
  const read = getPortalContactRequestManagerAuthorityFacts({
    portalRepo,
    managerRepo,
    identityPublicApi,
    staffPublicApi,
  })
  return { read, managerRepo }
}

describe('Portal Contact Request manager authority facts', () => {
  it('returns only exact creator and currently eligible assigned-manager facts', async () => {
    const { read } = setup()

    await expect(read(PORTAL.organizationId, PORTAL.id)).resolves.toEqual({
      propertyId: PORTAL.propertyId,
      creatorUserId: 'creator-1',
      responsibleManagerUserIds: ['manager-1'],
    })
  })

  it('returns null without consulting assignments when the exact Portal is absent', async () => {
    const { read, managerRepo } = setup()

    await expect(
      read(
        PORTAL.organizationId,
        '20000000-0000-4000-8000-000000000099' as typeof PORTAL.id,
      ),
    ).resolves.toBeNull()
    expect(managerRepo.listActive).not.toHaveBeenCalled()
  })
})
