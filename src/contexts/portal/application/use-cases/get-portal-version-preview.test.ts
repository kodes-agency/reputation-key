// Portal context — getPortalVersionPreview use case tests
import { describe, expect, it, vi } from 'vitest'
import { getPortalVersionPreview } from './get-portal-version-preview'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import {
  organizationId,
  portalId,
  propertyId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalPublicationSnapshot } from '../../domain/portal-publication-snapshot'
import { APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS } from '../approved-destination-age'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import {
  IMMERSIVE_HERO_ASSET_ID,
  immersiveSnapshot,
} from '../__fixtures__/immersive-snapshot'

const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
const PORTAL = portalId('d0000000-0000-0000-0000-000000000001')
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

function setup(options: Options = {}) {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([buildTestPortal({})])
  const snapshots = options.snapshots ?? [immersiveSnapshot()]
  const findSnapshotByVersion = vi.fn(
    async (_org, _portal, version: number) =>
      snapshots.find((item) => item.version === version) ?? null,
  )
  const validatedAfter: Date[] = []
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  mediaRepo.seed(options.assets ?? [])
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

const manager = () => buildTestAuthContext({ role: 'PropertyManager' })

describe('getPortalVersionPreview', () => {
  it('draws the chosen version, whichever one is live', async () => {
    const { useCase, findSnapshotByVersion } = setup()

    const outcome = await useCase({ portalId: PORTAL, version: 6 }, manager())

    expect(findSnapshotByVersion).toHaveBeenCalledWith(expect.anything(), PORTAL, 6)
    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview).toMatchObject({
      source: 'version',
      version: 6,
      locales: ['en', 'bg'],
    })
  })

  it('leaves out a tile whose address is no longer approved, as the page would once live', async () => {
    const { useCase } = setup({ approvedUris: ['https://harbor.example.com/menu'] })

    const outcome = await useCase({ portalId: PORTAL, version: 6 }, manager())

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview.experiences.en?.links.map((link) => link.label)).toEqual([
      'Menu',
    ])
  })

  it('applies the guest edge approval cut-off to the addresses', async () => {
    const { useCase, validatedAfter } = setup()

    await useCase({ portalId: PORTAL, version: 6 }, manager())

    expect(validatedAfter).toEqual([
      new Date(AT.getTime() - APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS),
    ])
  })

  it('shows the version its photograph only while it may still be served', async () => {
    const { useCase } = setup({
      assets: [
        buildTestPortalMediaAsset({
          id: IMMERSIVE_HERO_ASSET_ID as never,
          purpose: 'hero',
          organizationId: ORG,
          propertyId: PROPERTY,
        }),
      ],
    })

    const outcome = await useCase({ portalId: PORTAL, version: 6 }, manager())

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview.experiences.en?.brand.hero?.url).toBe(
      `/api/public/portal-media/${IMMERSIVE_HERO_ASSET_ID}`,
    )
  })

  it('says so when the version was published with the earlier page design', async () => {
    const legacy = {
      ...immersiveSnapshot(),
      configuration: { ...immersiveSnapshot().configuration, schemaVersion: 2 },
    } as unknown as PortalPublicationSnapshot
    const { useCase } = setup({ snapshots: [legacy] })

    expect(await useCase({ portalId: PORTAL, version: 6 }, manager())).toEqual({
      status: 'unavailable',
      source: 'version',
      reason: 'earlier_design',
    })
  })

  it('never puts an address into the answer', async () => {
    const { useCase } = setup()

    const json = JSON.stringify(
      await useCase({ portalId: PORTAL, version: 6 }, manager()),
    )

    expect(json).not.toContain('harbor.example.com')
  })

  it.each([0, -1, 1.5, Number.NaN])('refuses version %s', async (version) => {
    const { useCase } = setup()

    await expect(useCase({ portalId: PORTAL, version }, manager())).rejects.toMatchObject(
      { code: 'publication_snapshot_unavailable' },
    )
  })

  it('refuses a version the Portal never had, or one that no longer verifies', async () => {
    const { useCase } = setup()

    await expect(
      useCase({ portalId: PORTAL, version: 7 }, manager()),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
  })

  it('refuses a caller who holds no Portal read permission', async () => {
    const { useCase } = setup()

    await expect(
      useCase(
        { portalId: PORTAL, version: 6 },
        buildTestAuthContext({ effectivePermissions: new Set() }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a Portal in a Property the caller is not assigned to', async () => {
    const { useCase } = setup({
      accessible: [propertyId('a0000000-0000-0000-0000-0000000000ff')],
    })

    await expect(
      useCase({ portalId: PORTAL, version: 6 }, manager()),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('does not find a Portal of another organization', async () => {
    const { useCase } = setup()

    await expect(
      useCase(
        { portalId: PORTAL, version: 6 },
        buildTestAuthContext({
          role: 'PropertyManager',
          organizationId: organizationId('org-00000000-0000-0000-0000-0000000000aa'),
        }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })
})
