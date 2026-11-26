import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPortalPublicationHistory } from './get-portal-publication-history.server'
import { publicationSource } from '../domain/__fixtures__/publication-source'
import { buildPortalPublicationSnapshot } from '../publication/portal-publication-snapshot.server'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createPortalReadsWorld } from '../infrastructure/testing/portal-reads-world'
import type { PortalPublicationRepository } from '../publication/portal-publication-repository.port.server'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { PropertyId } from '#/shared/domain/ids'

const world = createPortalReadsWorld('pub-history')

setupIntegrationDb({
  orgA: world.orgA,
  orgB: world.orgB,
  tables: ['portals', 'properties'],
})

const NOW = new Date('2026-08-26T14:00:00.000Z')
const portal = world.portal({ publicationState: 'published' })
const ctx = world.ctx()

beforeEach(async () => {
  await world.seed([portal])
})
const source = publicationSource({
  organizationId: portal.organizationId,
  propertyId: portal.propertyId,
  portal: { id: portal.id, name: portal.name, slug: portal.slug },
  privateFeedbackThreshold: portal.privateFeedbackThreshold,
})
const destination = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=history-test',
  retrievedAt: new Date('2026-08-25T10:00:00.000Z'),
  sourceEpoch: 2,
  profileVersion: 3,
} as const

function publishedSnapshot(version: number, slug: string) {
  return buildPortalPublicationSnapshot({
    id: `snapshot-version-${version}`,
    portalId: portal.id,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    version,
    source: { ...source, portal: { ...source.portal, slug } },
    destination,
    createdBy: 'manager-1',
    createdAt: new Date(NOW.getTime() - (3 - version) * 60_000),
  })
}

const peopleApi = (accessible: readonly PropertyId[] | null = null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

function setup(
  options?: Readonly<{
    workingSlug?: string
    accessible?: PropertyId[]
    durablePending?: boolean
    closed?: boolean
  }>,
) {
  const portalRepo = world.portalRepo()
  const versionOne = publishedSnapshot(1, portal.slug)
  const versionTwo = publishedSnapshot(2, 'second-published-address')
  const findCurrentAndLatestActivation = vi.fn<
    PortalPublicationRepository['findCurrentAndLatestActivation']
  >(async () => {
    const records = [
      {
        activation: {
          id: 'activation-3',
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
          portalId: portal.id,
          snapshotId: versionOne.id,
          activationSequence: 3,
          kind: 'rollback',
          activatedBy: 'manager-2',
          activatedAt: NOW,
          deactivatedAt: null,
          deactivationReason: null,
        },
        snapshot: versionOne,
      },
      {
        activation: {
          id: 'activation-2',
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
          portalId: portal.id,
          snapshotId: versionTwo.id,
          activationSequence: 2,
          kind: 'publish',
          activatedBy: 'manager-1',
          activatedAt: new Date(NOW.getTime() - 60_000),
          deactivatedAt: NOW,
          deactivationReason: 'replaced',
        },
        snapshot: versionTwo,
      },
    ] as const
    return options?.closed
      ? { latest: records[0], current: null }
      : { latest: records[0], current: records[0] }
  })
  const publicationRepo = {
    loadWorkingCopy: vi.fn(async () => ({
      ...source,
      portal: { ...source.portal, slug: options?.workingSlug ?? portal.slug },
    })),
    findCurrentAndLatestActivation,
    listOpenPendingContentChanges: vi.fn(async () =>
      options?.durablePending
        ? [
            {
              kind: 'property_brand_content' as const,
              key: 'bg',
              sourceVersion: 'v2',
              changedAt: NOW,
              changedBy: 'manager-2',
            },
            {
              kind: 'portal_links' as const,
              key: 'all',
              sourceVersion: 'v3',
              changedAt: NOW,
              changedBy: null,
            },
          ]
        : [],
    ),
  } as unknown as PortalPublicationRepository
  return {
    useCase: getPortalPublicationHistory({
      portalRepo,
      publicationRepo,
      staffPublicApi: peopleApi(options?.accessible ?? null),
    }),
    publicationRepo,
    findCurrentAndLatestActivation,
  }
}

function setupLocalized(options?: Readonly<{ workingDisplayName?: string }>) {
  const portalRepo = world.portalRepo()
  const snapshot = buildPortalPublicationSnapshot({
    id: 'localized-snapshot-version-1',
    portalId: portal.id,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    version: 1,
    source,
    destination,
    createdBy: 'manager-1',
    createdAt: NOW,
  })
  const record = {
    activation: {
      id: 'localized-activation-1',
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      snapshotId: snapshot.id,
      activationSequence: 1,
      kind: 'publish' as const,
      activatedBy: 'manager-1',
      activatedAt: NOW,
      deactivatedAt: null,
      deactivationReason: null,
    },
    snapshot,
  }
  const publicationRepo = {
    loadWorkingCopy: vi.fn(async () => ({
      ...source,
      look: {
        ...source.look!,
        displayName: options?.workingDisplayName ?? source.look!.displayName,
      },
    })),
    findCurrentAndLatestActivation: vi.fn(async () => ({
      latest: record,
      current: record,
    })),
    listOpenPendingContentChanges: vi.fn(async () => []),
  } as unknown as PortalPublicationRepository

  return getPortalPublicationHistory({
    portalRepo,
    publicationRepo,
    staffPublicApi: peopleApi(),
  })
}

describe('getPortalPublicationHistory', () => {
  it('reads the live version of a rollback and no pending changes', async () => {
    const harness = setup()

    await expect(harness.useCase({ portalId: portal.id }, ctx)).resolves.toEqual({
      liveVersion: 1,
      pendingChangeCount: 0,
      hasPendingChanges: false,
    })
    expect(harness.findCurrentAndLatestActivation).toHaveBeenCalledWith(
      ctx.organizationId,
      portal.propertyId,
      portal.id,
    )
  })

  it('has no live version when the newest activation is closed', async () => {
    const harness = setup({ closed: true })

    const result = await harness.useCase({ portalId: portal.id }, ctx)

    expect(result.liveVersion).toBeNull()
    expect(result.hasPendingChanges).toBe(false)
  })

  it('marks saved content as pending when it differs from the live rollback', async () => {
    const harness = setup({ workingSlug: 'a-saved-address-for-the-next-publication' })

    const result = await harness.useCase({ portalId: portal.id }, ctx)

    expect(result).toMatchObject({ hasPendingChanges: true, liveVersion: 1 })
  })

  it('surfaces a durable pending change even when the resolved content still matches', async () => {
    const harness = setup({ durablePending: true })

    const result = await harness.useCase({ portalId: portal.id }, ctx)

    expect(result).toEqual({
      liveVersion: 1,
      pendingChangeCount: 2,
      hasPendingChanges: true,
    })
  })

  it('does not mark an identical localized experience as pending', async () => {
    const useCase = setupLocalized()

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.hasPendingChanges).toBe(false)
  })

  it('marks a changed Property brand profile as pending', async () => {
    const useCase = setupLocalized({ workingDisplayName: 'Updated Example Hotel' })

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.hasPendingChanges).toBe(true)
  })

  it('checks property access before reading publication content', async () => {
    const harness = setup({ accessible: [] })
    const propertyManager = world.ctx({ role: 'PropertyManager' })

    await expect(
      harness.useCase({ portalId: portal.id }, propertyManager),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(harness.publicationRepo.loadWorkingCopy).not.toHaveBeenCalled()
    expect(harness.findCurrentAndLatestActivation).not.toHaveBeenCalled()
  })
})
