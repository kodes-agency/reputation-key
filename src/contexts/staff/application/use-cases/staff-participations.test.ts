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
          row.linkedUserId === userId &&
          row.status === 'active',
      ) ?? null,
    list: async (orgId) => participations.filter((row) => row.organizationId === orgId),
    createParticipantWithParticipation: async ({ participation }) => {
      participations.push(participation)
      return participation
    },
    archive: async (orgId, id, at, reason, expectedRevision) => {
      const index = participations.findIndex(
        (row) => row.organizationId === orgId && row.id === id,
      )
      if (index < 0) return null
      if (participations[index].revision !== expectedRevision) {
        throw { _tag: 'StaffError', code: 'revision_conflict' }
      }
      const archived = {
        ...participations[index],
        status: 'archived' as const,
        endedAt: participations[index].endedAt ?? at,
        archiveReason: reason,
        revision: expectedRevision + 1,
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
      const participation = participations.find(
        (row) => row.id === input.staffParticipationId,
      )
      if (!participation || participation.revision !== input.expectedRevision) {
        throw { _tag: 'StaffError', code: 'revision_conflict' }
      }
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
      const nextRevision = input.expectedRevision + 1
      const index = participations.findIndex((row) => row.id === participation.id)
      participations[index] = { ...participation, revision: nextRevision }
      return { responsibilities: active, revision: nextRevision }
    },
  }
}

function deps(repo: StaffParticipationRepository) {
  return {
    repo,
    accessibleProperties: async () => [PROPERTY_ID],
    clock: () => NOW,
    idGen: () => PARTICIPATION_ID,
  }
}

describe('StaffParticipation lifecycle', () => {
  it('reconciles manager responsibility when a linked participation is archived', async () => {
    const repo = fakeRepository()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    repo.participations.push({
      id: PARTICIPATION_ID,
      organizationId: ctx.organizationId,
      propertyId: PROPERTY_ID,
      staffParticipantId: 'b0000000-0000-4000-8000-000000000002',
      linkedUserId: 'linked-manager',
      displayName: 'Linked manager',
      status: 'active',
      startedAt: NOW,
      endedAt: null,
      archiveReason: null,
      revision: 1,
      createdBy: ctx.userId,
      updatedAt: NOW,
    })
    const calls: string[][] = []

    await archiveStaffParticipation({
      ...deps(repo),
      reconcileResponsibleManagerEligibility: async (...input) => {
        calls.push(input)
      },
    })(
      {
        staffParticipationId: PARTICIPATION_ID,
        reason: 'left property',
        expectedRevision: 1,
      },
      ctx,
    )

    expect(calls).toEqual([[ctx.organizationId, 'linked-manager', ctx.userId]])
  })

  it('creates a participant without requiring a login identity', async () => {
    const repo = fakeRepository()
    const create = createStaffParticipation(deps(repo))
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const first = await create({ propertyId: PROPERTY_ID, displayName: 'Sam' }, ctx)

    expect(first.linkedUserId).toBeNull()
    expect(first.staffParticipantId).toBe(PARTICIPATION_ID)
    expect(repo.participations).toHaveLength(1)
  })

  it('archives the lifecycle and closes active responsibility history', async () => {
    const repo = fakeRepository()
    const create = createStaffParticipation(deps(repo))
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const participation = await create(
      { propertyId: PROPERTY_ID, displayName: 'Sam' },
      ctx,
    )
    await updatePortalResponsibilities(deps(repo))(
      {
        staffParticipationId: participation.id,
        primaryPortalId: 'portal-1',
        supportingPortalIds: ['portal-2'],
        expectedRevision: participation.revision,
      },
      ctx,
    )

    const archived = await archiveStaffParticipation(deps(repo))(
      {
        staffParticipationId: participation.id,
        reason: 'left_property',
        expectedRevision: participation.revision + 1,
      },
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
      { propertyId: PROPERTY_ID, displayName: 'Sam' },
      ctx,
    )
    await updatePortalResponsibilities(deps(repo))(
      {
        staffParticipationId: participation.id,
        primaryPortalId: 'portal-1',
        supportingPortalIds: ['portal-2', 'portal-3'],
        expectedRevision: participation.revision,
      },
      ctx,
    )

    const result = await listStaffParticipations(deps(repo))(
      { propertyId: PROPERTY_ID, activeOnly: true },
      ctx,
    )

    expect(result.participations).toEqual([{ ...participation, revision: 2 }])
    expect(result.responsibilities).toEqual([
      {
        staffParticipationId: participation.id,
        primaryPortalId: 'portal-1',
        supportingPortalIds: ['portal-2', 'portal-3'],
        revision: participation.revision + 1,
      },
    ])
  })

  it('rejects responsibility mutation for a participation from another tenant', async () => {
    const repo = fakeRepository()
    repo.participations.push({
      id: PARTICIPATION_ID,
      organizationId: 'other-org',
      propertyId: PROPERTY_ID,
      staffParticipantId: 'b0000000-0000-4000-8000-000000000002',
      linkedUserId: null,
      displayName: 'Sam',
      status: 'active',
      startedAt: NOW,
      endedAt: null,
      archiveReason: null,
      revision: 1,
      createdBy: 'owner',
      updatedAt: NOW,
    })

    await expect(
      updatePortalResponsibilities(deps(repo))(
        {
          staffParticipationId: PARTICIPATION_ID,
          primaryPortalId: 'portal-1',
          supportingPortalIds: [],
          expectedRevision: 1,
        },
        buildTestAuthContext({ role: 'PropertyManager' }),
      ),
    ).rejects.toMatchObject({ _tag: 'StaffError', code: 'participation_not_found' })
  })
})
