import { describe, expect, it, vi } from 'vitest'
import { getPortalVersion } from './get-portal-version'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { organizationId, userId } from '#/shared/domain/ids'
import type { UserId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalActorDirectory } from '../ports/portal-actor-directory.port'
import { immersiveConfiguration } from '../../domain/__fixtures__/immersive-configuration'
import type {
  ImmersiveLink,
  PortalPublicationConfiguration,
  PortalPublicationSnapshot,
} from '../../domain/portal-publication-snapshot'

const T0 = new Date('2026-09-01T10:00:00.000Z')
const portal = buildTestPortal({ createdAt: T0, createdBy: userId('creator') })
const ctx = buildTestAuthContext({ organizationId: portal.organizationId })

const base = immersiveConfiguration()
const [menu, spa] = base.links as [ImmersiveLink, ImmersiveLink]
const dinner: ImmersiveLink = {
  id: 'dinner',
  url: 'https://harbor.example.com/dinner',
  iconKey: null,
  imageAssetId: null,
  texts: {
    en: { label: 'Dinner', line: null, fallbackFrom: null },
    bg: { label: 'Вечеря', line: null, fallbackFrom: null },
  },
}

const snapshot = (
  version: number,
  configuration: PortalPublicationConfiguration,
  by = 'publisher',
): PortalPublicationSnapshot =>
  ({
    id: `snapshot-${version}`,
    version,
    configuration,
    createdBy: by,
    createdAt: new Date(T0.getTime() + version * 86_400_000),
  }) as PortalPublicationSnapshot

function setup(
  snapshots: readonly PortalPublicationSnapshot[],
  options: { live?: number | null; next?: number } = {},
) {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const live = options.live === undefined ? snapshots.at(-1)?.version : options.live
  const publicationRepo = {
    findSnapshotByVersion: vi.fn(
      async (_o, _p, version: number) =>
        snapshots.find((item) => item.version === version) ?? null,
    ),
    findActiveForPortal: vi.fn(
      async () => snapshots.find((item) => item.version === live) ?? null,
    ),
    getCursor: vi.fn(async () => ({
      nextSnapshotVersion: options.next ?? snapshots.length + 1,
      nextActivationSequence: 9,
    })),
  } as unknown as PortalPublicationRepository
  const actorDirectory: PortalActorDirectory = {
    resolveDisplayNames: async (_org, ids: readonly UserId[]) =>
      new Map(
        ids.flatMap((id) => (id === 'publisher' ? [[id, 'Elena Petrova'] as const] : [])),
      ),
  }
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
  }
  const useCase = getPortalVersion({
    portalRepo,
    staffPublicApi,
    publicationRepo,
    actorDirectory,
  })
  return { useCase, publicationRepo }
}

describe('getPortalVersion', () => {
  it('says what making an earlier version live would change back for guests', async () => {
    const v1 = snapshot(1, base)
    const v2 = snapshot(2, { ...base, links: [menu, spa, dinner] })
    const { useCase } = setup([v1, v2])

    const result = await useCase({ portalId: portal.id, version: 1 }, ctx)

    expect(result).toMatchObject({
      version: 1,
      isLive: false,
      liveVersion: 2,
      nextVersion: 3,
      publishedBy: { userId: 'publisher', displayName: 'Elena Petrova' },
      changesFromLive: [{ kind: 'link_removed', label: 'Dinner', hasPhoto: false }],
    })
  })

  it('says what making a later version live would bring back', async () => {
    const v1 = snapshot(1, base)
    const v2 = snapshot(2, { ...base, links: [menu, spa, dinner] })
    const { useCase } = setup([v1, v2], { live: 1 })

    const result = await useCase({ portalId: portal.id, version: 2 }, ctx)

    expect(result.changesFromLive).toEqual([
      { kind: 'link_added', label: 'Dinner', hasPhoto: false },
    ])
  })

  it('has nothing to change for the live version itself', async () => {
    const v1 = snapshot(1, base)
    const { useCase } = setup([v1])

    const result = await useCase({ portalId: portal.id, version: 1 }, ctx)

    expect(result).toMatchObject({ isLive: true, changesFromLive: [] })
  })

  it('has no live version to compare with while the page is off', async () => {
    const v1 = snapshot(1, base)
    const { useCase } = setup([v1], { live: null })

    const result = await useCase({ portalId: portal.id, version: 1 }, ctx)

    expect(result).toMatchObject({
      isLive: false,
      liveVersion: null,
      changesFromLive: [],
    })
  })

  it('describes the version in plain words: languages, wording, tiles and the section switch', async () => {
    const { useCase } = setup([snapshot(1, base)])

    const result = await useCase({ portalId: portal.id, version: 1 }, ctx)

    expect(result.content).toEqual({
      primaryLanguage: 'en',
      languages: ['en', 'bg'],
      title: 'Tell us about your visit',
      links: [
        { label: 'Menu', address: 'https://harbor.example.com/menu' },
        { label: 'Spa', address: 'https://harbor.example.com/spa' },
      ],
      linktreeEnabled: true,
    })
  })

  it('answers not found for a version the Portal never had', async () => {
    const { useCase } = setup([snapshot(1, base)])

    await expect(useCase({ portalId: portal.id, version: 7 }, ctx)).rejects.toMatchObject(
      { code: 'publication_snapshot_unavailable' },
    )
  })

  it('refuses a version number that is not a positive integer', async () => {
    const { useCase, publicationRepo } = setup([snapshot(1, base)])

    await expect(useCase({ portalId: portal.id, version: 0 }, ctx)).rejects.toMatchObject(
      { code: 'publication_snapshot_unavailable' },
    )
    expect(publicationRepo.findSnapshotByVersion).not.toHaveBeenCalled()
  })

  it('refuses a role without portal.read', async () => {
    const { useCase, publicationRepo } = setup([snapshot(1, base)])
    const denied = buildTestAuthContext({
      organizationId: portal.organizationId,
      effectivePermissions: new Set(),
    })

    await expect(
      useCase({ portalId: portal.id, version: 1 }, denied),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(publicationRepo.findSnapshotByVersion).not.toHaveBeenCalled()
  })

  it('does not find a portal of another organization', async () => {
    const { useCase } = setup([snapshot(1, base)])
    const other = buildTestAuthContext({ organizationId: organizationId('org-other') })

    await expect(
      useCase({ portalId: portal.id, version: 1 }, other),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })
})
