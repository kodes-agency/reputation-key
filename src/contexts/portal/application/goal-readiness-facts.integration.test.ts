// Portal context — goal-readiness facts tests

import { describe, expect, it, vi } from 'vitest'
import { createGoalReadinessFacts } from './goal-readiness-facts'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createPortalReadsWorld } from '../infrastructure/testing/portal-reads-world'
import { portalGroupId, type PortalId } from '#/shared/domain/ids'
import type { Portal, PortalGroup } from '../domain/types'
import type { PortalPublicationActivation } from '../domain/portal-publication-snapshot'
import type { ResolvablePortalTokenSummary } from './ports/portal-token.repository'

type GoalReadinessFactsDeps = Parameters<typeof createGoalReadinessFacts>[0]

// Oct 23, 2026, 12:00 in Sofia (UTC+3).
const AS_OF = new Date('2026-10-23T09:00:00.000Z')
const SIXTY_DAYS_BEFORE = new Date('2026-08-24T09:00:00.000Z')
const world = createPortalReadsWorld('goal-readiness')

const { getPool } = setupIntegrationDb({
  orgA: world.orgA,
  orgB: world.orgB,
  tables: ['portals', 'properties'],
})

const ORG = world.orgA
const PROPERTY = world.propertyA
const OTHER_PROPERTY = world.propertyB
const GROUP = portalGroupId('90000000-0000-0000-0000-000000000001')

const portal = (
  index: number,
  name: string,
  overrides: Partial<Omit<Portal, 'id'>> = {},
): Portal => world.portal({ name, slug: `portal-${index}`, ...overrides })

const activation = (
  of: Portal,
  activationSequence: number,
  activatedAt: string,
  closed: Readonly<{ at: string; reason: 'disabled' | 'archived' | 'replaced' }> | null,
): PortalPublicationActivation => ({
  id: `${of.id}-${activationSequence}`,
  organizationId: ORG,
  propertyId: PROPERTY,
  portalId: of.id,
  snapshotId: `snapshot-${of.id}`,
  activationSequence,
  kind: 'publish',
  activatedBy: 'manager-1',
  activatedAt: new Date(activatedAt),
  deactivatedAt: closed ? new Date(closed.at) : null,
  deactivationReason: closed?.reason ?? null,
})

const token = (
  of: Portal,
  issuedAt: string,
  hasPublishedAccessArtifact: boolean,
): ResolvablePortalTokenSummary & Readonly<{ portalId: PortalId }> => ({
  portalId: of.id,
  version: 1,
  issuedAt: new Date(issuedAt),
  gracePeriodEnds: null,
  hasPublishedAccessArtifact,
  addressKeyVersion: null,
  issuedBy: 'manager-1',
})

const group = (): PortalGroup => ({
  id: GROUP,
  organizationId: ORG,
  propertyId: PROPERTY,
  name: 'Pool side',
  sortKey: null,
  createdBy: null,
  createdAt: AS_OF,
  updatedAt: AS_OF,
  deletedAt: null,
})

type Sources = Readonly<{
  portals: readonly Portal[]
  activations?: readonly PortalPublicationActivation[]
  tokens?: readonly (ResolvablePortalTokenSummary & Readonly<{ portalId: PortalId }>)[]
  groups?: readonly Readonly<{ portalId: PortalId; group: PortalGroup }>[]
}>

const setup = async (sources: Sources) => {
  const portalRepo = world.portalRepo()
  await world.seed(sources.portals)
  const asked = (portalIds: readonly PortalId[]) => new Set<string>(portalIds)
  const listActivationsForPortals = vi.fn<
    GoalReadinessFactsDeps['publicationRepo']['listActivationsForPortals']
  >(async (_org, portalIds) =>
    (sources.activations ?? []).filter((row) => asked(portalIds).has(row.portalId)),
  )
  const findResolvableSummariesForPortals = vi.fn<
    GoalReadinessFactsDeps['portalTokenRepo']['findResolvableSummariesForPortals']
  >(async (_org, portalIds) =>
    (sources.tokens ?? []).filter((row) => asked(portalIds).has(row.portalId)),
  )
  const listGroupsForPortals = vi.fn<
    GoalReadinessFactsDeps['portalGroupRepo']['listGroupsForPortals']
  >(async (_org, portalIds) =>
    (sources.groups ?? []).filter((row) => asked(portalIds).has(row.portalId)),
  )
  const facts = createGoalReadinessFacts({
    portalRepo,
    publicationRepo: { listActivationsForPortals },
    portalTokenRepo: { findResolvableSummariesForPortals },
    portalGroupRepo: { listGroupsForPortals },
  })
  return {
    facts,
    listActivationsForPortals,
    findResolvableSummariesForPortals,
    listGroupsForPortals,
  }
}

describe('listGoalReadinessFacts', () => {
  it('lists live, draft and disabled portals in name order', async () => {
    const spa = portal(1, 'Spa')
    const reception = portal(2, 'Reception')
    const restaurant = portal(3, 'restaurant', { publicationState: 'draft' })
    const lobby = portal(4, 'Lobby', { publicationState: 'disabled' })
    const { facts, listActivationsForPortals, listGroupsForPortals } = await setup({
      portals: [spa, reception, restaurant, lobby],
      activations: [
        activation(reception, 1, '2026-10-09T06:00:00.000Z', {
          at: '2026-10-12T12:00:00.000Z',
          reason: 'replaced',
        }),
        activation(reception, 2, '2026-10-12T12:00:00.000Z', null),
        activation(spa, 1, '2026-10-15T07:00:00.000Z', null),
        activation(lobby, 1, '2026-10-01T06:00:00.000Z', {
          at: '2026-10-10T11:00:00.000Z',
          reason: 'disabled',
        }),
      ],
      groups: [{ portalId: spa.id, group: group() }],
    })

    const read = await facts.listGoalReadinessFacts(ORG, PROPERTY, AS_OF)

    expect(read).toEqual({
      truncated: false,
      portals: [
        {
          portalId: lobby.id,
          name: 'Lobby',
          publicationState: 'disabled',
          skipPrivateRating: false,
          liveSince: null,
          liveIntervals: [
            {
              from: new Date('2026-10-01T06:00:00.000Z'),
              to: new Date('2026-10-10T11:00:00.000Z'),
            },
          ],
          codeIssuedAt: null,
          codeReady: false,
          portalGroupId: null,
        },
        {
          portalId: reception.id,
          name: 'Reception',
          publicationState: 'published',
          skipPrivateRating: false,
          liveSince: new Date('2026-10-09T06:00:00.000Z'),
          liveIntervals: [{ from: new Date('2026-10-09T06:00:00.000Z'), to: null }],
          codeIssuedAt: null,
          codeReady: false,
          portalGroupId: null,
        },
        {
          portalId: restaurant.id,
          name: 'restaurant',
          publicationState: 'draft',
          skipPrivateRating: false,
          liveSince: null,
          liveIntervals: [],
          codeIssuedAt: null,
          codeReady: false,
          portalGroupId: null,
        },
        {
          portalId: spa.id,
          name: 'Spa',
          publicationState: 'published',
          skipPrivateRating: false,
          liveSince: new Date('2026-10-15T07:00:00.000Z'),
          liveIntervals: [{ from: new Date('2026-10-15T07:00:00.000Z'), to: null }],
          codeIssuedAt: null,
          codeReady: false,
          portalGroupId: GROUP,
        },
      ],
    })
    expect(listActivationsForPortals).toHaveBeenCalledWith(ORG, [
      lobby.id,
      reception.id,
      restaurant.id,
      spa.id,
    ])
    expect(listGroupsForPortals).toHaveBeenCalledWith(
      ORG,
      [lobby.id, reception.id, restaurant.id, spa.id],
      AS_OF,
    )
  })

  it('leaves out archived and deleted portals', async () => {
    const reception = portal(1, 'Reception')
    const archived = portal(2, 'Bar', { publicationState: 'archived' })
    const deleted = portal(3, 'Garden', { deletedAt: new Date('2026-10-01T00:00:00Z') })
    const elsewhere = portal(4, 'Beach', { propertyId: OTHER_PROPERTY })
    const { facts, listActivationsForPortals } = await setup({
      portals: [reception, archived, deleted, elsewhere],
      activations: [activation(archived, 1, '2026-10-01T06:00:00.000Z', null)],
    })

    const read = await facts.listGoalReadinessFacts(ORG, PROPERTY, AS_OF)

    expect(read.portals.map((fact) => fact.name)).toEqual(['Reception'])
    expect(listActivationsForPortals).toHaveBeenCalledWith(ORG, [reception.id])
  })

  it('live intervals reach back 60 days; live since keeps the start of the run', async () => {
    const reception = portal(1, 'Reception')
    const { facts } = await setup({
      portals: [reception],
      activations: [
        activation(reception, 1, '2026-07-01T06:00:00.000Z', {
          at: '2026-08-01T06:00:00.000Z',
          reason: 'disabled',
        }),
        activation(reception, 2, '2026-08-03T06:00:00.000Z', null),
      ],
    })

    const read = await facts.listGoalReadinessFacts(ORG, PROPERTY, AS_OF)

    expect(read.portals[0]).toMatchObject({
      liveSince: new Date('2026-08-03T06:00:00.000Z'),
      liveIntervals: [{ from: SIXTY_DAYS_BEFORE, to: null }],
    })
  })

  it('a code counts once its access artifact is published', async () => {
    const printed = portal(1, 'Printed')
    const unprinted = portal(2, 'Unprinted')
    const codeless = portal(3, 'Codeless')
    const { facts, findResolvableSummariesForPortals } = await setup({
      portals: [printed, unprinted, codeless],
      tokens: [
        token(printed, '2026-10-02T08:00:00.000Z', true),
        token(unprinted, '2026-10-06T08:00:00.000Z', false),
      ],
    })

    const read = await facts.listGoalReadinessFacts(ORG, PROPERTY, AS_OF)

    expect(
      read.portals.map(({ name, codeIssuedAt, codeReady }) => ({
        name,
        codeIssuedAt,
        codeReady,
      })),
    ).toEqual([
      { name: 'Codeless', codeIssuedAt: null, codeReady: false },
      {
        name: 'Printed',
        codeIssuedAt: new Date('2026-10-02T08:00:00.000Z'),
        codeReady: true,
      },
      {
        name: 'Unprinted',
        codeIssuedAt: new Date('2026-10-06T08:00:00.000Z'),
        codeReady: false,
      },
    ])
    expect(findResolvableSummariesForPortals).toHaveBeenCalledWith(
      ORG,
      [codeless.id, printed.id, unprinted.id],
      AS_OF,
    )
  })

  it('includes the complete roster beyond 100', async () => {
    // 101 portals named so that name order differs from storage order.
    const portals = Array.from({ length: 101 }, (_, index) =>
      portal(index + 1, `Portal ${String(101 - index).padStart(3, '0')}`),
    )
    const { facts, listActivationsForPortals } = await setup({ portals })

    const read = await facts.listGoalReadinessFacts(ORG, PROPERTY, AS_OF)

    expect(read.truncated).toBe(false)
    expect(read.portals).toHaveLength(101)
    expect(read.portals[0]?.name).toBe('Portal 001')
    expect(read.portals[99]?.name).toBe('Portal 100')
    expect(listActivationsForPortals.mock.calls[0]?.[1]).toHaveLength(101)

    await getPool().query(`DELETE FROM portals WHERE id = $1`, [portals[0]!.id])
    const exactly = await setup({ portals: [] })
    await expect(
      exactly.facts.listGoalReadinessFacts(ORG, PROPERTY, AS_OF),
    ).resolves.toMatchObject({ truncated: false })
  })

  it('never includes another organization’s portals', async () => {
    const own = portal(1, 'Reception')
    const foreign = portal(2, 'Reception', { propertyId: world.propertyOfB })
    const { facts } = await setup({ portals: [own, foreign] })

    const read = await facts.listGoalReadinessFacts(ORG, PROPERTY, AS_OF)
    const theirs = await facts.listGoalReadinessFacts(
      world.orgB,
      world.propertyOfB,
      AS_OF,
    )

    expect(read.portals.map((fact) => fact.portalId)).toEqual([own.id])
    expect(theirs.portals.map((fact) => fact.portalId)).toEqual([foreign.id])
    await expect(
      facts.listGoalReadinessFacts(world.orgB, PROPERTY, AS_OF),
    ).resolves.toMatchObject({ portals: [] })
  })

  it('reads nothing more for a Property with no portals', async () => {
    const { facts, listActivationsForPortals, findResolvableSummariesForPortals } =
      await setup({ portals: [] })

    await expect(facts.listGoalReadinessFacts(ORG, PROPERTY, AS_OF)).resolves.toEqual({
      portals: [],
      truncated: false,
    })
    expect(listActivationsForPortals).not.toHaveBeenCalled()
    expect(findResolvableSummariesForPortals).not.toHaveBeenCalled()
  })
})
