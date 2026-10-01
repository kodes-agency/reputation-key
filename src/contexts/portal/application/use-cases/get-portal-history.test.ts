import { describe, expect, it, vi } from 'vitest'
import { getPortalHistory, type PortalHistoryEntry } from './get-portal-history'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { organizationId, portalId, propertyId, userId } from '#/shared/domain/ids'
import type { UserId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { HistoryBound } from '../../domain/portal-history'
import type { PortalHealthInterval } from '../../domain/portal-health'
import type {
  PortalCodeDownloadRow,
  PortalCodeIssuanceRow,
  PortalCodeRevocationRow,
  PortalHistoryRepository,
  PortalPageEditRow,
  PortalPublicationEventRow,
} from '../ports/portal-history.repository'
import type { PortalHealthRepository } from '../ports/portal-health.repository'
import type { PortalActorDirectory } from '../ports/portal-actor-directory.port'

const T0 = new Date('2026-09-01T10:00:00.000Z')
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)
const portal = buildTestPortal({
  createdAt: at(0),
  createdBy: userId('creator'),
})
const ctx = buildTestAuthContext({ organizationId: portal.organizationId })

/** The bound contract, restated independently of the domain helper. */
function passes(bound: HistoryBound | null, rowAt: Date, id: string | null): boolean {
  if (bound === null) return true
  if (rowAt < bound.at) return true
  if (rowAt.getTime() !== bound.at.getTime() || !bound.inclusive) return false
  return bound.afterId === null || id === null || id < bound.afterId
}

function newestFirst<T>(rows: readonly T[], atOf: (row: T) => Date): readonly T[] {
  return [...rows].sort((a, b) => atOf(b).getTime() - atOf(a).getTime())
}

type Seed = Readonly<{
  publications?: readonly PortalPublicationEventRow[]
  issuances?: readonly PortalCodeIssuanceRow[]
  downloads?: readonly PortalCodeDownloadRow[]
  revocations?: readonly PortalCodeRevocationRow[]
  pageEdits?: readonly PortalPageEditRow[]
  health?: readonly Pick<
    PortalHealthInterval,
    'id' | 'status' | 'reason' | 'effectiveFrom'
  >[]
  names?: Readonly<Record<string, string>>
}>

function setup(seed: Seed = {}) {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const historyRepo = {
    listPublicationEvents: vi.fn(async (_o, _p, _pt, page) =>
      newestFirst(
        (seed.publications ?? []).filter((row) =>
          passes(page.bound, row.activatedAt, row.activationId),
        ),
        (row) => row.activatedAt,
      ).slice(0, page.limit),
    ),
    listCodeIssuances: vi.fn(async (_o, _p, _pt, page) =>
      newestFirst(
        (seed.issuances ?? []).filter((row) =>
          passes(page.bound, row.issuedAt, row.tokenId),
        ),
        (row) => row.issuedAt,
      ).slice(0, page.limit),
    ),
    listCodeDownloads: vi.fn(async (_o, _p, _pt, page) =>
      newestFirst(
        (seed.downloads ?? []).filter((row) =>
          passes(page.bound, row.downloadedAt, row.downloadId),
        ),
        (row) => row.downloadedAt,
      ).slice(0, page.limit),
    ),
    listCodeRevocations: vi.fn(async (_o, _p, _pt, page) =>
      newestFirst(
        (seed.revocations ?? []).filter((row) => passes(page.bound, row.revokedAt, null)),
        (row) => row.revokedAt,
      ).slice(0, page.limit),
    ),
    listPublishedVersions: vi.fn(async () => []),
    listPageEdits: vi.fn(async (_o, _p, _pt, page, since) =>
      newestFirst(
        (seed.pageEdits ?? []).filter(
          (row) =>
            row.occurredAt >= since && passes(page.bound, row.occurredAt, row.editId),
        ),
        (row) => row.occurredAt,
      ).slice(0, page.limit),
    ),
  } satisfies PortalHistoryRepository
  const healthRepo = {
    listHistory: vi.fn(async (_o, _p, _pt, limit, bound) =>
      newestFirst(
        (seed.health ?? []).filter((row) =>
          passes(bound ?? null, row.effectiveFrom, row.id),
        ),
        (row) => row.effectiveFrom,
      )
        .slice(0, limit)
        .map(
          (row) =>
            ({
              ...row,
              organizationId: portal.organizationId,
              propertyId: portal.propertyId,
              portalId: portal.id,
              sourceVersion: 'v',
              effectiveTo: null,
              observedAt: row.effectiveFrom,
            }) satisfies PortalHealthInterval,
        ),
    ),
  } as unknown as PortalHealthRepository
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
  const useCase = getPortalHistory({
    portalRepo,
    staffPublicApi,
    historyRepo,
    healthRepo,
    actorDirectory,
  })
  return { useCase, historyRepo, healthRepo, resolveDisplayNames, staffPublicApi }
}

const publication = (
  n: number,
  minutes: number,
  kind: 'publish' | 'rollback' = 'publish',
  version = n,
): PortalPublicationEventRow => ({
  activationId: `00000000-0000-4000-8000-00000000000${n}`,
  version,
  kind,
  activatedBy: 'publisher',
  activatedAt: at(minutes),
})

const download = (
  n: string,
  version: number,
  downloadedAt: Date,
  purpose: 'download' | 'copy' | 'show' = 'download',
): PortalCodeDownloadRow => ({
  downloadId: `00000000-0000-4000-8000-0000000000${n.padStart(2, 'c')}`,
  version,
  downloadedBy: 'publisher',
  purpose,
  downloadedAt,
})

const pageEdit = (
  n: number,
  minutes: number,
  over: Partial<PortalPageEditRow> = {},
): PortalPageEditRow => ({
  editId: `00000000-0000-4000-8000-00000000010${n}`,
  kind: 'portal_links',
  key: 'all',
  actorUserId: 'editor',
  occurredAt: at(minutes),
  propertyWide: false,
  previousText: null,
  newText: null,
  editCount: 1,
  ...over,
})

describe('getPortalHistory', () => {
  it('merges creation, publications, health and addresses newest first with actors named', async () => {
    const { useCase } = setup({
      publications: [publication(1, 10), publication(2, 30, 'rollback', 1)],
      health: [
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          status: 'degraded',
          reason: 'responsibility_needed',
          effectiveFrom: at(20),
        },
      ],
      issuances: [
        {
          tokenId: '00000000-0000-4000-8000-0000000000b1',
          version: 1,
          issuedAt: at(5),
          issuedBy: null,
          predecessor: null,
        },
      ],
      revocations: [{ revokedAt: at(40), revokedBy: 'publisher', reason: 'Card lost' }],
      names: { publisher: 'Elena Petrova', creator: 'Georgi Ivanov' },
    })

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.nextCursor).toBeNull()
    expect(
      result.entries.map((entry) => [entry.occurredAt, entry.category, entry.detail]),
    ).toEqual([
      [at(40).toISOString(), 'codes', { kind: 'codes_revoked', reason: 'Card lost' }],
      [at(30).toISOString(), 'publishing', { kind: 'version_restored', version: 1 }],
      [
        at(20).toISOString(),
        'health',
        { kind: 'health_changed', status: 'degraded', reason: 'responsibility_needed' },
      ],
      [at(10).toISOString(), 'publishing', { kind: 'version_published', version: 1 }],
      [at(5).toISOString(), 'codes', { kind: 'code_issued', version: 1 }],
      [at(0).toISOString(), 'publishing', { kind: 'portal_created' }],
    ])
    expect(result.entries[0]?.actor).toEqual({
      userId: 'publisher',
      displayName: 'Elena Petrova',
    })
    expect(result.entries.at(-1)?.actor).toEqual({
      userId: 'creator',
      displayName: 'Georgi Ivanov',
    })
  })

  it('records no actor for system facts and for an address with no recorded issuer', async () => {
    const { useCase } = setup({
      health: [
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          status: 'healthy',
          reason: 'operational',
          effectiveFrom: at(20),
        },
      ],
      issuances: [
        {
          tokenId: '00000000-0000-4000-8000-0000000000b1',
          version: 1,
          issuedAt: at(5),
          issuedBy: null,
          predecessor: null,
        },
      ],
    })

    const result = await useCase({ portalId: portal.id }, ctx)

    const byKind = (kind: string) =>
      result.entries.find((entry) => entry.detail.kind === kind)
    expect(byKind('health_changed')?.actor).toBeNull()
    expect(byKind('code_issued')?.actor).toBeNull()
  })

  it('names who made an address when it was recorded', async () => {
    const { useCase } = setup({
      issuances: [
        {
          tokenId: '00000000-0000-4000-8000-0000000000b1',
          version: 1,
          issuedAt: at(5),
          issuedBy: 'publisher',
          predecessor: null,
        },
      ],
      names: { publisher: 'Elena Petrova' },
    })

    const result = await useCase({ portalId: portal.id, filter: 'codes' }, ctx)

    expect(result.entries[0]).toMatchObject({
      detail: { kind: 'code_issued', version: 1 },
      actor: { userId: 'publisher', displayName: 'Elena Petrova' },
    })
  })

  it('lists each time a code was downloaded again, with who and what for', async () => {
    const { useCase } = setup({
      downloads: [
        download('1', 2, at(30)),
        { ...download('2', 2, at(40), 'copy'), downloadedBy: 'creator' },
      ],
      names: { publisher: 'Elena Petrova', creator: 'Georgi Ivanov' },
    })

    const result = await useCase({ portalId: portal.id, filter: 'codes' }, ctx)

    expect(
      result.entries.map((entry) => [entry.category, entry.detail, entry.actor]),
    ).toEqual([
      [
        'codes',
        { kind: 'code_downloaded', version: 2, purpose: 'copy' },
        { userId: 'creator', displayName: 'Georgi Ivanov' },
      ],
      [
        'codes',
        { kind: 'code_downloaded', version: 2, purpose: 'download' },
        { userId: 'publisher', displayName: 'Elena Petrova' },
      ],
    ])
    expect(
      result.entries.every((entry) => entry.key.startsWith('code-downloaded:')),
    ).toBe(true)
  })

  it('keeps an actor without a resolvable name, with no name', async () => {
    const { useCase } = setup({ publications: [publication(1, 10)] })

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.entries[0]?.actor).toEqual({ userId: 'publisher', displayName: null })
  })

  it('has no creation actor for a portal that predates creator provenance', async () => {
    const legacy = buildTestPortal({
      id: 'd0000000-0000-0000-0000-0000000000f1',
      createdBy: null,
      createdAt: at(0),
    })
    const portalRepo = createInMemoryPortalRepo()
    portalRepo.seed([legacy])
    const harness = setup()
    const useCase = getPortalHistory({
      portalRepo,
      staffPublicApi: harness.staffPublicApi,
      historyRepo: harness.historyRepo,
      healthRepo: harness.healthRepo,
      actorDirectory: { resolveDisplayNames: harness.resolveDisplayNames },
    })

    const result = await useCase({ portalId: legacy.id }, ctx)

    expect(result.entries).toEqual([
      {
        key: `created:${legacy.id}`,
        category: 'publishing',
        occurredAt: at(0).toISOString(),
        actor: null,
        detail: { kind: 'portal_created' },
      },
    ])
  })

  it('classifies an address issued over a live one as a replacement', async () => {
    const { useCase } = setup({
      issuances: [
        {
          tokenId: '00000000-0000-4000-8000-0000000000b2',
          version: 2,
          issuedAt: at(50),
          issuedBy: null,
          predecessor: { revokedAt: null, gracePeriodEnds: at(80) },
        },
      ],
    })

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.entries[0]?.detail).toEqual({
      kind: 'code_replaced',
      version: 2,
      previousCodesWorkUntil: at(80).toISOString(),
    })
  })

  it('pages through every source without losing or repeating an entry, ties included', async () => {
    const tie = at(30)
    const seed: Seed = {
      publications: [
        publication(1, 10),
        { ...publication(2, 0), activatedAt: tie },
        publication(3, 50),
      ],
      health: [
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          status: 'healthy',
          reason: 'operational',
          effectiveFrom: tie,
        },
        {
          id: '00000000-0000-4000-8000-0000000000a2',
          status: 'unavailable',
          reason: 'publication_disabled',
          effectiveFrom: at(60),
        },
      ],
      issuances: [
        {
          tokenId: '00000000-0000-4000-8000-0000000000b1',
          version: 1,
          issuedAt: tie,
          issuedBy: null,
          predecessor: null,
        },
        {
          tokenId: '00000000-0000-4000-8000-0000000000b2',
          version: 2,
          issuedAt: at(5),
          issuedBy: null,
          predecessor: { revokedAt: at(4), gracePeriodEnds: null },
        },
      ],
      downloads: [
        download('d1', 1, tie),
        download('d2', 2, tie),
        download('d3', 2, at(45)),
      ],
      revocations: [
        { revokedAt: tie, revokedBy: 'publisher', reason: 'a' },
        { revokedAt: at(4), revokedBy: 'publisher', reason: 'b' },
      ],
      pageEdits: [pageEdit(1, 30), pageEdit(2, 30), pageEdit(3, 7)],
    }
    const { useCase } = setup(seed)
    const everything = await useCase({ portalId: portal.id, limit: 50 }, ctx)
    expect(everything.entries).toHaveLength(16)

    for (const limit of [1, 2, 3, 4, 7]) {
      const seen: PortalHistoryEntry[] = []
      let cursor: string | undefined
      for (let guard = 0; guard < 20; guard += 1) {
        const page = await useCase({ portalId: portal.id, limit, cursor }, ctx)
        seen.push(...page.entries)
        if (page.nextCursor === null) break
        cursor = page.nextCursor
      }
      expect(seen.map((entry) => entry.key)).toEqual(
        everything.entries.map((entry) => entry.key),
      )
    }
  })

  it('reads only the sources a tab needs', async () => {
    const { useCase, historyRepo, healthRepo } = setup({
      health: [
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          status: 'healthy',
          reason: 'operational',
          effectiveFrom: at(20),
        },
      ],
      publications: [publication(1, 10)],
    })

    const result = await useCase({ portalId: portal.id, filter: 'health' }, ctx)

    expect(result.entries.map((entry) => entry.category)).toEqual(['health'])
    expect(historyRepo.listPublicationEvents).not.toHaveBeenCalled()
    expect(historyRepo.listCodeIssuances).not.toHaveBeenCalled()
    expect(historyRepo.listCodeRevocations).not.toHaveBeenCalled()
    expect(historyRepo.listCodeDownloads).not.toHaveBeenCalled()
    expect(historyRepo.listPageEdits).not.toHaveBeenCalled()
    expect(healthRepo.listHistory).toHaveBeenCalledTimes(1)
  })

  it('names what each page edit touched and who did it', async () => {
    const { useCase } = setup({
      pageEdits: [
        pageEdit(1, 20, {
          kind: 'portal_links',
          key: 'link:3f0c2a0e-1111-4222-8333-444455556666:updated',
          previousText: 'Dinner menu',
          newText: 'Olive Terrace menu',
          editCount: 3,
        }),
        pageEdit(2, 10, {
          kind: 'property_brand_profile',
          key: 'look:accent',
          propertyWide: true,
          actorUserId: null,
        }),
      ],
      names: { editor: 'Elena Petrova' },
    })

    const result = await useCase({ portalId: portal.id, filter: 'edits' }, ctx)

    expect(
      result.entries.map((entry) => [entry.key, entry.category, entry.detail]),
    ).toEqual([
      [
        'edit:00000000-0000-4000-8000-000000000101',
        'edits',
        {
          kind: 'page_edited',
          subject: {
            area: 'link',
            linkId: '3f0c2a0e-1111-4222-8333-444455556666',
            change: 'updated',
          },
          propertyWide: false,
          previousText: 'Dinner menu',
          newText: 'Olive Terrace menu',
          editCount: 3,
        },
      ],
      [
        'edit:00000000-0000-4000-8000-000000000102',
        'edits',
        {
          kind: 'page_edited',
          subject: { area: 'look', facet: 'accent' },
          propertyWide: true,
          previousText: null,
          newText: null,
          editCount: 1,
        },
      ],
    ])
    expect(result.entries[0]?.actor).toEqual({
      userId: 'editor',
      displayName: 'Elena Petrova',
    })
    expect(result.entries[1]?.actor).toBeNull()
  })

  it('reads the ledger only on the All and Page edits tabs, and never before the page existed', async () => {
    const { useCase, historyRepo } = setup({ pageEdits: [pageEdit(1, 5)] })

    const all = await useCase({ portalId: portal.id }, ctx)
    expect(all.entries.map((entry) => entry.category)).toContain('edits')
    expect(historyRepo.listPageEdits).toHaveBeenCalledWith(
      ctx.organizationId,
      propertyId(portal.propertyId),
      portalId(portal.id),
      { bound: null, limit: 21 },
      portal.createdAt,
    )

    historyRepo.listPageEdits.mockClear()
    await useCase({ portalId: portal.id, filter: 'codes' }, ctx)
    await useCase({ portalId: portal.id, filter: 'publishing' }, ctx)
    expect(historyRepo.listPageEdits).not.toHaveBeenCalled()
  })

  it('shows creation on the publishing tab and not on the codes tab', async () => {
    const { useCase } = setup()

    const publishing = await useCase({ portalId: portal.id, filter: 'publishing' }, ctx)
    const codes = await useCase({ portalId: portal.id, filter: 'codes' }, ctx)

    expect(publishing.entries.map((entry) => entry.detail.kind)).toEqual([
      'portal_created',
    ])
    expect(codes.entries).toEqual([])
  })

  it('bounds the page size and ignores a malformed cursor', async () => {
    const { useCase, historyRepo } = setup()

    await useCase({ portalId: portal.id, limit: 9_999, cursor: 'not-a-cursor' }, ctx)
    await useCase({ portalId: portal.id, limit: Number.NaN }, ctx)

    expect(historyRepo.listPublicationEvents).toHaveBeenNthCalledWith(
      1,
      ctx.organizationId,
      portal.propertyId,
      portal.id,
      { bound: null, limit: 51 },
    )
    expect(historyRepo.listPublicationEvents).toHaveBeenNthCalledWith(
      2,
      ctx.organizationId,
      portal.propertyId,
      portal.id,
      { bound: null, limit: 21 },
    )
  })

  it('resolves names with one directory call for the whole page', async () => {
    const { useCase, resolveDisplayNames } = setup({
      publications: [publication(1, 10), publication(2, 20)],
    })

    await useCase({ portalId: portal.id }, ctx)

    expect(resolveDisplayNames).toHaveBeenCalledTimes(1)
    const [, ids] = resolveDisplayNames.mock.calls[0] ?? []
    expect([...(ids ?? [])].sort()).toEqual(['creator', 'publisher'])
  })

  it('refuses a role without portal.read before reading any source', async () => {
    const { useCase, historyRepo, healthRepo } = setup()
    const denied = buildTestAuthContext({
      organizationId: portal.organizationId,
      effectivePermissions: new Set(),
    })

    await expect(useCase({ portalId: portal.id }, denied)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(historyRepo.listPublicationEvents).not.toHaveBeenCalled()
    expect(healthRepo.listHistory).not.toHaveBeenCalled()
  })

  it('refuses a Property the manager is not assigned to before reading any source', async () => {
    const harness = setup()
    const scoped = getPortalHistory({
      portalRepo: (() => {
        const repo = createInMemoryPortalRepo()
        repo.seed([portal])
        return repo
      })(),
      staffPublicApi: {
        ...harness.staffPublicApi,
        getAccessiblePropertyIds: async () => [],
      },
      historyRepo: harness.historyRepo,
      healthRepo: harness.healthRepo,
      actorDirectory: { resolveDisplayNames: harness.resolveDisplayNames },
    })

    await expect(scoped({ portalId: portal.id }, ctx)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(harness.historyRepo.listPublicationEvents).not.toHaveBeenCalled()
  })

  it('does not find a portal of another organization', async () => {
    const { useCase } = setup()
    const other = buildTestAuthContext({ organizationId: organizationId('org-other') })

    await expect(useCase({ portalId: portal.id }, other)).rejects.toMatchObject({
      code: 'portal_not_found',
    })
  })

  it('has no cross-property bleed: sources are asked for this portal only', async () => {
    const { useCase, historyRepo } = setup()

    await useCase({ portalId: portal.id }, ctx)

    expect(historyRepo.listCodeIssuances).toHaveBeenCalledWith(
      ctx.organizationId,
      propertyId(portal.propertyId),
      portalId(portal.id),
      { bound: null, limit: 21 },
    )
  })
})
