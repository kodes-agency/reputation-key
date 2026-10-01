// Portal context — list portal overview use case tests

import { describe, it, expect, vi } from 'vitest'
import { listPortalOverview, type ListPortalOverviewDeps } from './list-portal-overview'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalGroup } from '../../domain/types'
import type { PortalHealthInterval } from '../../domain/portal-health'
import type { PortalResponsibleManager } from '../../domain/portal-responsible-manager'

const NOW = new Date('2026-09-10T12:00:00.000Z')
const ISSUED_AT = new Date('2026-09-01T09:30:00.000Z')
const PROPERTY_A = propertyId('a0000000-0000-0000-0000-000000000001')
const PROPERTY_B = propertyId('b0000000-0000-0000-0000-000000000002')
const GROUP = portalGroupId('90000000-0000-0000-0000-000000000001')
const OTHER_ORG = organizationId('org-00000000-0000-0000-0000-000000000002')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const health = (pid: PortalId, status: 'healthy' | 'degraded', reason: string) =>
  ({
    id: `h-${pid}`,
    portalId: pid,
    status,
    reason,
    effectiveTo: null,
  }) as unknown as PortalHealthInterval

const manager = (pid: PortalId, userId: string) =>
  ({ portalId: pid, userId, effectiveTo: null }) as unknown as PortalResponsibleManager

const group = (name = 'Pool side'): PortalGroup => ({
  id: GROUP,
  organizationId: buildTestAuthContext().organizationId,
  propertyId: PROPERTY_A,
  name,
  sortKey: null,
  createdBy: null,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
})

type Sources = Readonly<{
  health?: readonly PortalHealthInterval[]
  pending?: readonly { portalId: PortalId; count: number }[]
  groups?: readonly { portalId: PortalId; group: PortalGroup }[]
  managers?: readonly PortalResponsibleManager[]
  tokens?: readonly {
    portalId: PortalId
    version: number
    issuedAt: Date
    gracePeriodEnds: Date | null
    hasPublishedAccessArtifact: boolean
    addressKeyVersion: number | null
  }[]
}>

const setup = (
  accessible: ReadonlyArray<PropertyId> | null = null,
  sources: Sources = {},
) => {
  const portalRepo = createInMemoryPortalRepo()
  const listCurrentForPortals = vi.fn<
    ListPortalOverviewDeps['portalHealthRepo']['listCurrentForPortals']
  >(async () => sources.health ?? [])
  const countOpenPendingContentChanges = vi.fn<
    ListPortalOverviewDeps['publicationRepo']['countOpenPendingContentChanges']
  >(async () => sources.pending ?? [])
  const listGroupsForPortals = vi.fn<
    ListPortalOverviewDeps['portalGroupRepo']['listGroupsForPortals']
  >(async () => sources.groups ?? [])
  const listActiveForPortals = vi.fn<
    ListPortalOverviewDeps['managerRepo']['listActiveForPortals']
  >(async () => sources.managers ?? [])
  const findResolvableSummariesForPortals = vi.fn<
    ListPortalOverviewDeps['portalTokenRepo']['findResolvableSummariesForPortals']
  >(async () => sources.tokens ?? [])
  const useCase = listPortalOverview({
    portalRepo,
    portalHealthRepo: { listCurrentForPortals },
    publicationRepo: { countOpenPendingContentChanges },
    portalGroupRepo: { listGroupsForPortals },
    managerRepo: { listActiveForPortals },
    portalTokenRepo: { findResolvableSummariesForPortals },
    staffPublicApi: staffApiMock(accessible),
    addressCipher: null,
    clock: () => NOW,
  })
  return {
    useCase,
    portalRepo,
    reads: {
      listCurrentForPortals,
      countOpenPendingContentChanges,
      listGroupsForPortals,
      listActiveForPortals,
      findResolvableSummariesForPortals,
    },
  }
}

const ORGANIZATION = { scope: 'organization' } as const

describe('listPortalOverview', () => {
  it('returns, per portal, its locales, health, pending changes, group, managers, token and publication state', async () => {
    const pool = buildTestPortal({
      id: 'p-pool',
      name: 'Pool side',
      slug: 'pool-side',
      publicationState: 'published',
      primaryGuestLocale: 'en',
      additionalGuestLocales: ['bg', 'de'],
      propertyId: PROPERTY_A,
    })
    const { useCase, portalRepo } = setup(null, {
      health: [health(pool.id, 'degraded', 'responsibility_needed')],
      pending: [{ portalId: pool.id, count: 3 }],
      groups: [{ portalId: pool.id, group: group() }],
      managers: [manager(pool.id, 'user-b'), manager(pool.id, 'user-a')],
      tokens: [
        {
          portalId: pool.id,
          version: 2,
          issuedAt: ISSUED_AT,
          gracePeriodEnds: null,
          hasPublishedAccessArtifact: true,
          addressKeyVersion: null,
        },
      ],
    })
    portalRepo.seed([pool])

    const rows = await useCase(ORGANIZATION, buildTestAuthContext())

    expect(rows).toEqual([
      {
        portalId: pool.id,
        propertyId: PROPERTY_A,
        name: 'Pool side',
        slug: 'pool-side',
        publicationState: 'published',
        primaryGuestLocale: 'en',
        additionalGuestLocales: ['bg', 'de'],
        health: { status: 'degraded', reason: 'responsibility_needed' },
        pendingChangeCount: 3,
        group: { id: GROUP, name: 'Pool side' },
        responsibleManagerUserIds: ['user-a', 'user-b'],
        token: {
          hasActiveToken: true,
          qualifiedScanReady: true,
          version: 2,
          issuedAt: ISSUED_AT.toISOString(),
          graceExpiresAt: null,
          addressRecoverable: false,
        },
      },
    ])
  })

  it('reports a portal nothing is known about as having no health, changes, group, managers or token', async () => {
    const { useCase, portalRepo } = setup()
    portalRepo.seed([buildTestPortal({ id: 'p-bare', publicationState: 'draft' })])

    const [row] = await useCase(ORGANIZATION, buildTestAuthContext())

    expect(row).toMatchObject({
      publicationState: 'draft',
      health: null,
      pendingChangeCount: 0,
      group: null,
      responsibleManagerUserIds: [],
      token: {
        hasActiveToken: false,
        qualifiedScanReady: false,
        version: null,
        issuedAt: null,
        graceExpiresAt: null,
      },
    })
  })

  it('reads each source once for all the portals, however many there are', async () => {
    const { useCase, portalRepo, reads } = setup()
    const portals = Array.from({ length: 40 }, (_, index) =>
      buildTestPortal({ id: `p-${index}`, slug: `p-${index}` }),
    )
    portalRepo.seed(portals)
    const ctx = buildTestAuthContext()

    const rows = await useCase(ORGANIZATION, ctx)

    expect(rows).toHaveLength(40)
    for (const read of Object.values(reads)) {
      expect(read).toHaveBeenCalledTimes(1)
    }
    expect(reads.listCurrentForPortals).toHaveBeenCalledWith(
      ctx.organizationId,
      expect.arrayContaining(portals.map((portal) => portal.id)),
    )
    expect(reads.findResolvableSummariesForPortals).toHaveBeenCalledWith(
      ctx.organizationId,
      expect.any(Array),
      NOW,
    )
    expect(reads.listGroupsForPortals).toHaveBeenCalledWith(
      ctx.organizationId,
      expect.any(Array),
      NOW,
    )
  })

  it('reads one property when asked for one', async () => {
    const { useCase, portalRepo } = setup()
    const inA = buildTestPortal({ id: 'p-a', propertyId: PROPERTY_A })
    const inB = buildTestPortal({ id: 'p-b', propertyId: PROPERTY_B })
    portalRepo.seed([inA, inB])

    const rows = await useCase(
      { scope: 'property', propertyId: PROPERTY_B },
      buildTestAuthContext(),
    )

    expect(rows.map((row) => row.portalId)).toEqual([inB.id])
  })

  it('narrows an organisation read to the properties the caller may execute, none meaning none', async () => {
    const { useCase, portalRepo, reads } = setup()
    const inA = buildTestPortal({ id: 'p-a', propertyId: PROPERTY_A })
    const inB = buildTestPortal({ id: 'p-b', propertyId: PROPERTY_B })
    portalRepo.seed([inA, inB])
    const ctx = buildTestAuthContext()

    const narrowed = await useCase(
      { scope: 'organization', propertyIds: [PROPERTY_B] },
      ctx,
    )
    const none = await useCase({ scope: 'organization', propertyIds: [] }, ctx)

    expect(narrowed.map((row) => row.portalId)).toEqual([inB.id])
    expect(none).toEqual([])
    expect(reads.listCurrentForPortals).toHaveBeenCalledTimes(1)
  })

  it('shows a property manager only the properties assigned to them', async () => {
    const { useCase, portalRepo, reads } = setup([PROPERTY_A])
    const inA = buildTestPortal({ id: 'p-a', propertyId: PROPERTY_A })
    const inB = buildTestPortal({ id: 'p-b', propertyId: PROPERTY_B })
    portalRepo.seed([inA, inB])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const everywhere = await useCase(ORGANIZATION, ctx)
    const elsewhere = await useCase({ scope: 'property', propertyId: PROPERTY_B }, ctx)

    expect(everywhere.map((row) => row.portalId)).toEqual([inA.id])
    expect(elsewhere).toEqual([])
    // Nothing is read for portals the person may not see.
    expect(reads.listCurrentForPortals).toHaveBeenCalledWith(ctx.organizationId, [inA.id])
  })

  it('reads nothing at all when no portal is visible', async () => {
    const { useCase, reads } = setup()

    await expect(useCase(ORGANIZATION, buildTestAuthContext())).resolves.toEqual([])

    for (const read of Object.values(reads)) {
      expect(read).not.toHaveBeenCalled()
    }
  })

  it('never includes another organisation, nor a deleted portal', async () => {
    const { useCase, portalRepo } = setup()
    const own = buildTestPortal({ id: 'p-own' })
    portalRepo.seed([
      own,
      buildTestPortal({ id: 'p-other', organizationId: OTHER_ORG }),
      buildTestPortal({ id: 'p-gone', deletedAt: NOW }),
    ])

    const rows = await useCase(ORGANIZATION, buildTestAuthContext())

    expect(rows.map((row) => row.portalId)).toEqual([own.id])
  })

  it('ignores a source row that names a portal outside the read', async () => {
    const stranger = portalId('ee000000-0000-4000-8000-0000000000ff')
    const { useCase, portalRepo } = setup(null, {
      health: [health(stranger, 'healthy', 'operational')],
      pending: [{ portalId: stranger, count: 9 }],
      managers: [manager(stranger, 'user-x')],
    })
    portalRepo.seed([buildTestPortal({ id: 'p-own' })])

    const rows = await useCase(ORGANIZATION, buildTestAuthContext())

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      health: null,
      pendingChangeCount: 0,
      responsibleManagerUserIds: [],
    })
  })

  it('lists portals by name, then by id, so the answer does not depend on storage order', async () => {
    const { useCase, portalRepo } = setup()
    // Stored in descending id order, so storage order is the wrong answer.
    const tied = [
      buildTestPortal({ id: 'p-2', name: 'Bar' }),
      buildTestPortal({ id: 'p-4', name: 'Bar' }),
    ].sort((a, b) => (a.id < b.id ? -1 : 1))
    portalRepo.seed([
      buildTestPortal({ id: 'p-3', name: 'Spa' }),
      buildTestPortal({ id: 'p-1', name: 'lobby' }),
      ...[...tied].reverse(),
    ])

    const rows = await useCase(ORGANIZATION, buildTestAuthContext())

    expect(rows.map((row) => row.name)).toEqual(['Bar', 'Bar', 'lobby', 'Spa'])
    const tiedIds = rows.filter((row) => row.name === 'Bar').map((row) => row.portalId)
    expect(tiedIds).toEqual(tied.map((portal) => portal.id))
  })

  it('refuses a caller without portal.read', async () => {
    const { useCase, reads } = setup()
    const ctx = buildTestAuthContext({ effectivePermissions: new Set() })

    await expect(useCase(ORGANIZATION, ctx)).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'forbidden',
    )
    expect(reads.listCurrentForPortals).not.toHaveBeenCalled()
  })
})
