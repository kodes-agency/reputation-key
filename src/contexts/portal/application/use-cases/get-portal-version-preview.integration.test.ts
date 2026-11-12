// Portal context — getPortalVersionPreview use case tests
import { randomUUID } from 'node:crypto'
import { getDb } from '#/shared/db'
import { createPortalMediaAssetRepository } from '../../infrastructure/repositories/portal-media-asset.repository'
import { describe, expect, it, vi } from 'vitest'
import { getPortalVersionPreview } from './get-portal-version-preview'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createPortalReadsWorld } from '../../infrastructure/testing/portal-reads-world'
import { propertyId, type PropertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalPublicationSnapshot } from '../../domain/portal-publication-snapshot'
import { APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS } from '../approved-destination-age'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import {
  immersiveConfiguration,
  immersiveSnapshot,
} from '../__fixtures__/immersive-snapshot'

const world = createPortalReadsWorld('version-preview')

setupIntegrationDb({
  orgA: world.orgA,
  orgB: world.orgB,
  tables: ['portal_media_assets', 'portals', 'properties'],
})

const portalUnderTest = world.portal()
// A fresh image id: the stored image row must not collide with another suite.
const HERO_ASSET_ID = randomUUID()
const snapshot = () => {
  const { brandProfile } = immersiveConfiguration()
  return immersiveSnapshot(
    immersiveConfiguration({
      brandProfile: {
        ...brandProfile,
        hero: brandProfile.hero && { ...brandProfile.hero, assetId: HERO_ASSET_ID },
      },
    }),
  )
}
const AT = new Date('2026-10-01T10:00:00Z')
const published = ['https://harbor.example.com/menu', 'https://harbor.example.com/spa']

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

type Options = Readonly<{
  snapshots?: readonly PortalPublicationSnapshot[]
  approvedUris?: readonly string[]
  accessible?: ReadonlyArray<PropertyId> | null
  assets?: ReturnType<typeof buildTestPortalMediaAsset>[]
}>

async function setup(options: Options = {}) {
  const portalRepo = world.portalRepo()
  await world.seed([portalUnderTest])
  const snapshots = options.snapshots ?? [snapshot()]
  const findSnapshotByVersion = vi.fn(
    async (_org, _portal, version: number) =>
      snapshots.find((item) => item.version === version) ?? null,
  )
  const validatedAfter: Date[] = []
  await world.seedMedia(options.assets ?? [])
  const mediaRepo = createPortalMediaAssetRepository(getDb())
  const useCase = getPortalVersionPreview({
    portalRepo,
    mediaRepo,
    staffPublicApi: staffApi(options.accessible ?? null),
    publicationRepo: {
      findSnapshotByVersion,
    } as unknown as Pick<PortalPublicationRepository, 'findSnapshotByVersion'>,
    destinationRepo: {
      listApprovedUris: async (_org, _property, uris, after) => {
        validatedAfter.push(after)
        return uris.filter((uri) => (options.approvedUris ?? published).includes(uri))
      },
    },
    clock: () => AT,
  })
  return { useCase, findSnapshotByVersion, validatedAfter }
}

const manager = () => world.ctx({ role: 'PropertyManager' })

describe('getPortalVersionPreview', () => {
  it('draws the chosen version, whichever one is live', async () => {
    const { useCase, findSnapshotByVersion } = await setup()

    const outcome = await useCase({ portalId: portalUnderTest.id, version: 6 }, manager())

    expect(findSnapshotByVersion).toHaveBeenCalledWith(
      expect.anything(),
      portalUnderTest.id,
      6,
    )
    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview).toMatchObject({
      source: 'version',
      version: 6,
      locales: ['en', 'bg'],
    })
  })

  it('leaves out a tile whose address is no longer approved, as the page would once live', async () => {
    const { useCase } = await setup({ approvedUris: ['https://harbor.example.com/menu'] })

    const outcome = await useCase({ portalId: portalUnderTest.id, version: 6 }, manager())

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview.experiences.en?.links.map((link) => link.label)).toEqual([
      'Menu',
    ])
  })

  it('applies the guest edge approval cut-off to the addresses', async () => {
    const { useCase, validatedAfter } = await setup()

    await useCase({ portalId: portalUnderTest.id, version: 6 }, manager())

    expect(validatedAfter).toEqual([
      new Date(AT.getTime() - APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS),
    ])
  })

  it('shows the version its photograph only while it may still be served', async () => {
    const { useCase } = await setup({
      assets: [
        buildTestPortalMediaAsset({
          id: HERO_ASSET_ID as never,
          purpose: 'hero',
          organizationId: world.orgA,
          propertyId: world.propertyA,
        }),
      ],
    })

    const outcome = await useCase({ portalId: portalUnderTest.id, version: 6 }, manager())

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview.experiences.en?.brand.hero?.url).toBe(
      `/api/public/portal-media/${HERO_ASSET_ID}`,
    )
  })

  it('says so when the version was published with the earlier page design', async () => {
    const legacy = {
      ...snapshot(),
      configuration: { ...snapshot().configuration, schemaVersion: 2 },
    } as unknown as PortalPublicationSnapshot
    const { useCase } = await setup({ snapshots: [legacy] })

    expect(
      await useCase({ portalId: portalUnderTest.id, version: 6 }, manager()),
    ).toEqual({
      status: 'unavailable',
      source: 'version',
      reason: 'earlier_design',
    })
  })

  it('never puts an address into the answer', async () => {
    const { useCase } = await setup()

    const json = JSON.stringify(
      await useCase({ portalId: portalUnderTest.id, version: 6 }, manager()),
    )

    expect(json).not.toContain('harbor.example.com')
  })

  it.each([0, -1, 1.5, Number.NaN])('refuses version %s', async (version) => {
    const { useCase } = await setup()

    await expect(
      useCase({ portalId: portalUnderTest.id, version }, manager()),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
  })

  it('refuses a version the Portal never had', async () => {
    const { useCase } = await setup()

    await expect(
      useCase({ portalId: portalUnderTest.id, version: 7 }, manager()),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
  })

  it('refuses a caller who holds no Portal read permission', async () => {
    const { useCase } = await setup()

    await expect(
      useCase(
        { portalId: portalUnderTest.id, version: 6 },
        world.ctx({ effectivePermissions: new Set() }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a Portal in a Property the caller is not assigned to', async () => {
    const { useCase } = await setup({
      accessible: [propertyId(randomUUID())],
    })

    await expect(
      useCase({ portalId: portalUnderTest.id, version: 6 }, manager()),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('does not find a Portal of another organization', async () => {
    const { useCase } = await setup()

    await expect(
      useCase(
        { portalId: portalUnderTest.id, version: 6 },
        world.ctx({
          role: 'PropertyManager',
          organizationId: world.orgB,
        }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })
})
