import { describe, expect, it, vi } from 'vitest'
import { getPortalVersions } from './get-portal-versions'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { organizationId, userId } from '#/shared/domain/ids'
import type { UserId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type {
  PortalHistoryRepository,
  PortalPageEditRow,
  PortalPublishedVersionRow,
} from '../ports/portal-history.repository'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalActorDirectory } from '../ports/portal-actor-directory.port'
import {
  bulgarianPrimaryConfiguration,
  immersiveConfiguration,
} from '../../domain/__fixtures__/immersive-configuration'
import type { PortalPublicationSnapshot } from '../../domain/portal-publication-snapshot'

const T0 = new Date('2026-09-01T10:00:00.000Z')
const at = (days: number) => new Date(T0.getTime() + days * 86_400_000)
const portal = buildTestPortal({ createdAt: at(0), createdBy: userId('creator') })
const ctx = buildTestAuthContext({ organizationId: portal.organizationId })

const base = immersiveConfiguration()
const [menu, spa] = base.links as [
  (typeof base.links)[number],
  (typeof base.links)[number],
]

const version = (
  n: number,
  days: number,
  configuration = base,
  by = 'publisher',
): PortalPublishedVersionRow => ({
  version: n,
  publishedAt: at(days),
  publishedBy: by,
  configuration,
})

const edit = (days: number, actor: string | null = 'editor'): PortalPageEditRow => ({
  editId: `00000000-0000-4000-8000-0000000001${days}`,
  kind: 'portal_links',
  key: 'all',
  actorUserId: actor,
  occurredAt: at(days),
  propertyWide: false,
  previousText: null,
  newText: null,
  editCount: 1,
})

type Seed = Readonly<{
  /** Oldest first: the order a person would write them in. */
  versions?: readonly PortalPublishedVersionRow[]
  live?: number | null
  edits?: readonly PortalPageEditRow[]
  names?: Readonly<Record<string, string>>
}>

function setup(seed: Seed = {}) {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const newestFirst = [...(seed.versions ?? [])].sort((a, b) => b.version - a.version)
  const historyRepo = {
    listPublishedVersions: vi.fn(async (_o, _p, _pt, limit: number) =>
      newestFirst.slice(0, limit),
    ),
    listPageEdits: vi.fn(async (_o, _p, _pt, _page, since: Date) =>
      [...(seed.edits ?? [])]
        .filter((row) => row.occurredAt >= since)
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
    ),
  } as unknown as PortalHistoryRepository
  const publicationRepo = {
    findActiveForPortal: vi.fn(async () =>
      seed.live == null ? null : ({ version: seed.live } as PortalPublicationSnapshot),
    ),
  } as unknown as PortalPublicationRepository
  const resolveDisplayNames = vi.fn(
    async (_org: unknown, ids: readonly UserId[]): Promise<ReadonlyMap<UserId, string>> =>
      new Map(
        ids.flatMap((id) => {
          const name = seed.names?.[id]
          return name === undefined ? [] : [[id, name] as const]
        }),
      ),
  )
  const actorDirectory: PortalActorDirectory = { resolveDisplayNames }
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
  }
  const useCase = getPortalVersions({
    portalRepo,
    staffPublicApi,
    historyRepo,
    publicationRepo,
    actorDirectory,
  })
  return { useCase, historyRepo, resolveDisplayNames, publicationRepo }
}

describe('getPortalVersions', () => {
  it('lists versions newest first, each with who published it and what it added', async () => {
    const withDinner = {
      ...base,
      links: [
        menu,
        spa,
        {
          id: 'dinner',
          url: 'https://harbor.example.com/dinner',
          iconKey: null,
          imageAssetId: null,
          texts: {
            en: { label: 'Dinner', line: null, fallbackFrom: null },
            bg: { label: 'Вечеря', line: null, fallbackFrom: null },
          },
        },
      ],
    }
    const { useCase } = setup({
      versions: [version(1, 1), version(2, 5, withDinner, 'second')],
      live: 2,
      names: { publisher: 'Georgi Ivanov', second: 'Elena Petrova' },
    })

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.versions.map((item) => item.version)).toEqual([2, 1])
    expect(result.versions[0]).toMatchObject({
      version: 2,
      isLive: true,
      isFirst: false,
      publishedAt: at(5).toISOString(),
      publishedBy: { userId: 'second', displayName: 'Elena Petrova' },
      changes: [{ kind: 'link_added', label: 'Dinner', hasPhoto: false }],
    })
    expect(result.versions[1]).toMatchObject({
      version: 1,
      isLive: false,
      isFirst: true,
      languages: ['en', 'bg'],
    })
    expect(result.liveVersion).toBe(2)
    expect(result.truncated).toBe(false)
  })

  it('marks the version that is live, which need not be the newest', async () => {
    const { useCase } = setup({
      versions: [version(1, 1), version(2, 5)],
      live: 1,
    })

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.versions.map((item) => [item.version, item.isLive])).toEqual([
      [2, false],
      [1, true],
    ])
    // Making version 1 live never touches the draft, which still holds version 2.
    expect(result.draft.basedOnVersion).toBe(2)
  })

  it('has no live version while the page is off, and the draft is based on the newest', async () => {
    const { useCase } = setup({ versions: [version(1, 1), version(2, 5)], live: null })

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.liveVersion).toBeNull()
    expect(result.draft.basedOnVersion).toBe(2)
  })

  it('has no versions and no base for a portal that was never published', async () => {
    const { useCase } = setup()

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result).toMatchObject({
      versions: [],
      liveVersion: null,
      draft: { basedOnVersion: null, lastEdit: null },
    })
  })

  it('names the draft as last edited by the newest page edit after the newest version', async () => {
    const { useCase } = setup({
      versions: [version(1, 1)],
      live: 1,
      edits: [edit(2, 'old'), edit(3, 'editor')],
      names: { editor: 'Elena Petrova' },
    })

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.draft.lastEdit).toEqual({
      at: at(3).toISOString(),
      actor: { userId: 'editor', displayName: 'Elena Petrova' },
    })
  })

  it('has no draft edit when every page edit went into a published version', async () => {
    const { useCase } = setup({
      versions: [version(1, 1), version(2, 5)],
      live: 2,
      edits: [edit(3)],
    })

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.draft.lastEdit).toBeNull()
  })

  it('keeps a draft edit by the system without an actor', async () => {
    const { useCase } = setup({
      versions: [version(1, 1)],
      live: 1,
      edits: [edit(3, null)],
    })

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.draft.lastEdit).toEqual({ at: at(3).toISOString(), actor: null })
  })

  it('keeps a publisher the directory cannot name, with no name', async () => {
    const { useCase } = setup({ versions: [version(1, 1)], live: 1 })

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.versions[0]?.publishedBy).toEqual({
      userId: 'publisher',
      displayName: null,
    })
  })

  it('says a primary-language change in the version that made it', async () => {
    const { useCase } = setup({
      versions: [version(1, 1), version(2, 2, bulgarianPrimaryConfiguration())],
      live: 2,
    })

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.versions[0]?.changes).toContainEqual({
      kind: 'primary_language_changed',
      from: 'en',
      to: 'bg',
    })
  })

  it('lists at most 200 versions and says there are older ones', async () => {
    const many = Array.from({ length: 205 }, (_, index) => version(index + 1, index))
    const { useCase, historyRepo } = setup({ versions: many, live: 205 })

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(historyRepo.listPublishedVersions).toHaveBeenCalledWith(
      ctx.organizationId,
      portal.propertyId,
      portal.id,
      201,
    )
    expect(result.versions).toHaveLength(200)
    expect(result.versions.at(-1)?.version).toBe(6)
    expect(result.versions.at(-1)?.isFirst).toBe(false)
    expect(result.truncated).toBe(true)
  })

  it('resolves every name in one batch of at most 100 people', async () => {
    const many = Array.from({ length: 150 }, (_, index) =>
      version(index + 1, index, base, `person-${index}`),
    )
    const { useCase, resolveDisplayNames } = setup({ versions: many, live: 150 })

    await useCase({ portalId: portal.id }, ctx)

    const sizes = resolveDisplayNames.mock.calls.map(([, ids]) => ids.length)
    expect(sizes.every((size) => size <= 100)).toBe(true)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(150)
  })

  it('refuses a role without portal.read before reading anything', async () => {
    const { useCase, historyRepo } = setup()
    const denied = buildTestAuthContext({
      organizationId: portal.organizationId,
      effectivePermissions: new Set(),
    })

    await expect(useCase({ portalId: portal.id }, denied)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(historyRepo.listPublishedVersions).not.toHaveBeenCalled()
  })

  it('does not find a portal of another organization', async () => {
    const { useCase } = setup()
    const other = buildTestAuthContext({ organizationId: organizationId('org-other') })

    await expect(useCase({ portalId: portal.id }, other)).rejects.toMatchObject({
      code: 'portal_not_found',
    })
  })
})
