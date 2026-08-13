import { describe, expect, it } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import type { StaffParticipationRepository } from '../ports/staff-participation.repository'
import type { StaffParticipation } from '../../domain/staff-participation'
import type { PortalResponsibility } from '../../domain/portal-responsibility'
import {
  archiveStaffParticipation,
  createStaffParticipation,
  updatePortalResponsibilities,
  listStaffParticipations,
} from './staff-participations'
import { propertyId } from '#/shared/domain/ids'

const NOW = new Date('2026-08-08T12:00:00.000Z')
const PROPERTY_ID = propertyId('a0000000-0000-4000-8000-000000000001')
const PARTICIPATION_ID = 'b0000000-0000-4000-8000-000000000001'

function fakeRepository(): StaffParticipationRepository & {
  participations: StaffParticipation[]
  responsibilities: PortalResponsibility[]
} {
  const participations: StaffParticipation[] = []
  const responsibilities: PortalResponsibility[] = []
  return {
    participations,
    responsibilities,
    findById: async (orgId, id) =>
      participations.find((row) => row.organizationId === orgId && row.id === id) ?? null,
    findActiveByUser: async (orgId, propertyId, userId) =>
      participations.find(
        (row) =>
          row.organizationId === orgId &&
          row.propertyId === propertyId &&
          row.userId === userId &&
          row.status === 'active',
      ) ?? null,
    list: async (orgId) => participations.filter((row) => row.organizationId === orgId),
    create: async (row) => {
      participations.push(row)
      return row
    },
    archive: async (orgId, id, at) => {
      const index = participations.findIndex(
        (row) => row.organizationId === orgId && row.id === id,
      )
      if (index < 0) return null
      const archived = {
        ...participations[index],
        status: 'archived' as const,
        endedAt: participations[index].endedAt ?? at,
        updatedAt: at,
      }
      participations[index] = archived
      for (let i = 0; i < responsibilities.length; i += 1) {
        if (
          responsibilities[i].staffParticipationId === id &&
          responsibilities[i].effectiveTo === null
        ) {
          responsibilities[i] = {
            ...responsibilities[i],
            effectiveTo: at,
            endReason: 'participation_archived',
          }
        }
      }
      return archived
    },
    listActiveResponsibilities: async (orgId, id) =>
      responsibilities.filter(
        (row) =>
          row.organizationId === orgId &&
          row.staffParticipationId === id &&
          row.effectiveTo === null,
      ),
    replaceResponsibilities: async (input) => {
      for (let i = 0; i < responsibilities.length; i += 1) {
        const row = responsibilities[i]
        if (
          row.organizationId === input.organizationId &&
          row.staffParticipationId === input.staffParticipationId &&
          row.effectiveTo === null
        ) {
          responsibilities[i] = {
            ...row,
            effectiveTo: input.at,
            endReason: 'responsibility_reassigned',
          }
        }
      }
      const active = input.selections.map((selection, index) => ({
        id: `responsibility-${index}`,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        portalId: selection.portalId,
        staffParticipationId: input.staffParticipationId,
        kind: selection.kind,
        effectiveFrom: input.at,
        effectiveTo: null,
        createdBy: input.actorId,
        endReason: null,
      }))
      responsibilities.push(...active)
      return active
    },
  }
}

function deps(repo: StaffParticipationRepository) {
  return {
    repo,
    identityMembership: { isMember: async () => true },
    accessibleProperties: async () => [PROPERTY_ID],
    clock: () => NOW,
    idGen: () => PARTICIPATION_ID,
  }
}

describe('StaffParticipation lifecycle', () => {
  it('creates idempotently without changing property access', async () => {
    const repo = fakeRepository()
    const create = createStaffParticipation(deps(repo))
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const input = { propertyId: PROPERTY_ID, userId: 'user-1', displayName: 'Sam' }

    const first = await create(input, ctx)
    const second = await create(input, ctx)

    expect(second.id).toBe(first.id)
    expect(repo.participations).toHaveLength(1)
  })

  it('archives the lifecycle and closes active responsibility history', async () => {
    const repo = fakeRepository()
    const create = createStaffParticipation(deps(repo))
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const participation = await create(
      { propertyId: PROPERTY_ID, userId: 'user-1', displayName: 'Sam' },
      ctx,
    )
    await updatePortalResponsibilities(deps(repo))(
      {
        staffParticipationId: participation.id,
        primaryPortalId: 'portal-1',
        supportingPortalIds: ['portal-2'],
      },
      ctx,
    )

    const archived = await archiveStaffParticipation(deps(repo))(
      { staffParticipationId: participation.id, reason: 'left_property' },
      ctx,
    )

    expect(archived.status).toBe('archived')
    expect(
      repo.responsibilities.every((row) => row.effectiveTo?.getTime() === NOW.getTime()),
    ).toBe(true)
  })

  it('returns active responsibility selections with the participation list', async () => {
    const repo = fakeRepository()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const participation = await createStaffParticipation(deps(repo))(
      { propertyId: PROPERTY_ID, userId: 'user-1', displayName: 'Sam' },
      ctx,
    )
    await updatePortalResponsibilities(deps(repo))(
      {
        staffParticipationId: participation.id,
        primaryPortalId: 'portal-1',
        supportingPortalIds: ['portal-2', 'portal-3'],
      },
      ctx,
    )

    const result = await listStaffParticipations(deps(repo))(
      { propertyId: PROPERTY_ID, activeOnly: true },
      ctx,
    )

    expect(result.participations).toEqual([participation])
    expect(result.responsibilities).toEqual([
      {
        staffParticipationId: participation.id,
        primaryPortalId: 'portal-1',
        supportingPortalIds: ['portal-2', 'portal-3'],
      },
    ])
  })

  it('rejects responsibility mutation for a participation from another tenant', async () => {
    const repo = fakeRepository()
    repo.participations.push({
      id: PARTICIPATION_ID,
      organizationId: 'other-org',
      propertyId: PROPERTY_ID,
      userId: 'user-1',
      displayName: 'Sam',
      status: 'active',
      startedAt: NOW,
      endedAt: null,
      createdBy: 'owner',
      updatedAt: NOW,
    })

    await expect(
      updatePortalResponsibilities(deps(repo))(
        {
          staffParticipationId: PARTICIPATION_ID,
          primaryPortalId: 'portal-1',
          supportingPortalIds: [],
        },
        buildTestAuthContext({ role: 'PropertyManager' }),
      ),
    ).rejects.toMatchObject({ _tag: 'StaffError', code: 'participation_not_found' })
  })
})
