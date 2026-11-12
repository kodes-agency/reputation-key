// Portal context — list portal overview use case tests

import { describe, it, expect, vi } from 'vitest'
import { listPortalOverview, type ListPortalOverviewDeps } from './list-portal-overview'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createPortalReadsWorld } from '../../infrastructure/testing/portal-reads-world'
import { isPortalError } from '../../domain/errors'
import {
  portalGroupId,
  portalId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalGroup } from '../../domain/types'
import type { PortalHealthInterval } from '../../domain/portal-health'
import type { PortalResponsibleManager } from '../../domain/portal-responsible-manager'
import type { PortalLookSources } from '../../domain/portal-look'

const world = createPortalReadsWorld('list-overview')

setupIntegrationDb({
  orgA: world.orgA,
  orgB: world.orgB,
  tables: ['portals', 'properties'],
})

const NOW = new Date('2026-09-10T12:00:00.000Z')
const ISSUED_AT = new Date('2026-09-01T09:30:00.000Z')
const GROUP = portalGroupId('90000000-0000-0000-0000-000000000001')

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
  organizationId: world.orgA,
  propertyId: world.propertyA,
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
    issuedBy: string | null
  }[]
  /** The Portals that have a look of their own and where its groups come from. */
  looks?: readonly { portalId: PortalId; sources: PortalLookSources }[]
}>

const setup = (
  accessible: ReadonlyArray<PropertyId> | null = null,
  sources: Sources = {},
) => {
  const portalRepo = world.portalRepo()
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
  const listSourcesForPortals = vi.fn<
    ListPortalOverviewDeps['portalLookRepo']['listSourcesForPortals']
  >(async () => sources.looks ?? [])
  const useCase = listPortalOverview({
    portalRepo,
    portalHealthRepo: { listCurrentForPortals },
    publicationRepo: { countOpenPendingContentChanges },
    portalGroupRepo: { listGroupsForPortals },
    managerRepo: { listActiveForPortals },
    portalTokenRepo: { findResolvableSummariesForPortals },
    portalLookRepo: { listSourcesForPortals },
    staffPublicApi: staffApiMock(accessible),
    addressCipher: null,
    clock: () => NOW,
  })
  return {
    useCase,
    reads: {
      listCurrentForPortals,
      countOpenPendingContentChanges,
      listGroupsForPortals,
      listActiveForPortals,
      findResolvableSummariesForPortals,
      listSourcesForPortals,
    },
  }
}

const ORGANIZATION = { scope: 'organization' } as const

describe('listPortalOverview', () => {
  it('returns, per portal, its locales, health, pending changes, group, managers, token and publication state', async () => {
    const pool = world.portal({
      name: 'Pool side',
      slug: 'pool-side',
      publicationState: 'published',
      primaryGuestLocale: 'en',
      additionalGuestLocales: ['bg', 'de'],
      propertyId: world.propertyA,
    })
    const { useCase } = setup(null, {
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
          issuedBy: null,
        },
      ],
    })
    await world.seed([pool])

    const rows = await useCase(ORGANIZATION, world.ctx())

    expect(rows).toEqual([
      {
        portalId: pool.id,
        kind: 'place',
        propertyId: world.propertyA,
        name: 'Pool side',
        slug: 'pool-side',
        skipPrivateRating: false,
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
          madeBy: null,
        },
      },
    ])
  })

  it('reports a portal nothing is known about as having no health, changes, group, managers or token', async () => {
    const { useCase } = setup()
    await world.seed([world.portal({ publicationState: 'draft' })])

    const [row] = await useCase(ORGANIZATION, world.ctx())

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

  it('says where the look of a portal with a look of its own comes from, and says nothing for the others', async () => {
    const spa = world.portal({ name: 'Spa', slug: 'spa' })
    const lobby = world.portal({ name: 'Lobby', slug: 'lobby' })
    const sources: PortalLookSources = {
      photo: 'none',
      colours: 'property',
      identity: 'portal',
    }
    const { useCase } = setup(null, {
      looks: [{ portalId: spa.id, sources }],
    })
    await world.seed([spa, lobby])

    const rows = await useCase(ORGANIZATION, world.ctx())

    const byName = Object.fromEntries(rows.map((row) => [row.name, row]))
    expect(byName['Spa']?.lookSources).toEqual(sources)
    // A portal with no row follows the whole Property look: it carries no sources.
    expect(byName['Lobby']).not.toHaveProperty('lookSources')
  })

  it('reads each source once for all the portals, however many there are', async () => {
    const { useCase, reads } = setup()
    const portals = Array.from({ length: 40 }, (_, index) =>
      world.portal({ slug: `p-${index}` }),
    )
    await world.seed(portals)
    const ctx = world.ctx()

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
    // The look read names each Portal with its Property, so a row is held to both.
    expect(reads.listSourcesForPortals).toHaveBeenCalledWith(
      ctx.organizationId,
      expect.arrayContaining(
        portals.map((portal) => ({ propertyId: portal.propertyId, portalId: portal.id })),
      ),
    )
  })

  it('reads one property when asked for one', async () => {
    const { useCase } = setup()
    const inA = world.portal({ propertyId: world.propertyA })
    const inB = world.portal({ propertyId: world.propertyB })
    await world.seed([inA, inB])

    const rows = await useCase(
      { scope: 'property', propertyId: world.propertyB },
      world.ctx(),
    )

    expect(rows.map((row) => row.portalId)).toEqual([inB.id])
  })

  it('narrows an organisation read to the properties the caller may execute, none meaning none', async () => {
    const { useCase, reads } = setup()
    const inA = world.portal({ propertyId: world.propertyA })
    const inB = world.portal({ propertyId: world.propertyB })
    await world.seed([inA, inB])
    const ctx = world.ctx()

    const narrowed = await useCase(
      { scope: 'organization', propertyIds: [world.propertyB] },
      ctx,
    )
    const none = await useCase({ scope: 'organization', propertyIds: [] }, ctx)

    expect(narrowed.map((row) => row.portalId)).toEqual([inB.id])
    expect(none).toEqual([])
    expect(reads.listCurrentForPortals).toHaveBeenCalledTimes(1)
  })

  it('shows a property manager only the properties assigned to them', async () => {
    const { useCase, reads } = setup([world.propertyA])
    const inA = world.portal({ propertyId: world.propertyA })
    const inB = world.portal({ propertyId: world.propertyB })
    await world.seed([inA, inB])
    const ctx = world.ctx({ role: 'PropertyManager' })

    const everywhere = await useCase(ORGANIZATION, ctx)
    const elsewhere = await useCase(
      { scope: 'property', propertyId: world.propertyB },
      ctx,
    )

    expect(everywhere.map((row) => row.portalId)).toEqual([inA.id])
    expect(elsewhere).toEqual([])
    // Nothing is read for portals the person may not see.
    expect(reads.listCurrentForPortals).toHaveBeenCalledWith(ctx.organizationId, [inA.id])
  })

  it('reads nothing at all when no portal is visible', async () => {
    const { useCase, reads } = setup()

    await expect(useCase(ORGANIZATION, world.ctx())).resolves.toEqual([])

    for (const read of Object.values(reads)) {
      expect(read).not.toHaveBeenCalled()
    }
  })

  it('never includes another organisation, nor a deleted portal', async () => {
    const { useCase } = setup()
    const own = world.portal()
    const foreign = world.portal({ propertyId: world.propertyOfB })
    await world.seed([own, foreign, world.portal({ deletedAt: NOW })])

    const rows = await useCase(ORGANIZATION, world.ctx())

    expect(rows.map((row) => row.portalId)).toEqual([own.id])
    const theirs = await useCase(ORGANIZATION, world.ctxB())
    expect(theirs.map((row) => row.portalId)).toEqual([foreign.id])
  })

  it('ignores a source row that names a portal outside the read', async () => {
    const stranger = portalId('ee000000-0000-4000-8000-0000000000ff')
    const { useCase } = setup(null, {
      health: [health(stranger, 'healthy', 'operational')],
      pending: [{ portalId: stranger, count: 9 }],
      managers: [manager(stranger, 'user-x')],
      looks: [
        {
          portalId: stranger,
          sources: { photo: 'portal', colours: 'portal', identity: 'portal' },
        },
      ],
    })
    await world.seed([world.portal()])

    const rows = await useCase(ORGANIZATION, world.ctx())

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      health: null,
      pendingChangeCount: 0,
      responsibleManagerUserIds: [],
    })
    expect(rows[0]).not.toHaveProperty('lookSources')
  })

  it('lists portals by name, then by id, so the answer does not depend on storage order', async () => {
    const { useCase } = setup()
    // Stored in descending id order, so storage order is the wrong answer.
    const tied = [world.portal({ name: 'Bar' }), world.portal({ name: 'Bar' })].sort(
      (a, b) => (a.id < b.id ? -1 : 1),
    )
    await world.seed([
      world.portal({ name: 'Spa' }),
      world.portal({ name: 'lobby' }),
      ...[...tied].reverse(),
    ])

    const rows = await useCase(ORGANIZATION, world.ctx())

    expect(rows.map((row) => row.name)).toEqual(['Bar', 'Bar', 'lobby', 'Spa'])
    const tiedIds = rows.filter((row) => row.name === 'Bar').map((row) => row.portalId)
    expect(tiedIds).toEqual(tied.map((portal) => portal.id))
  })

  it('refuses a caller without portal.read', async () => {
    const { useCase, reads } = setup()
    const ctx = world.ctx({ effectivePermissions: new Set() })

    await expect(useCase(ORGANIZATION, ctx)).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'forbidden',
    )
    expect(reads.listCurrentForPortals).not.toHaveBeenCalled()
  })
})
