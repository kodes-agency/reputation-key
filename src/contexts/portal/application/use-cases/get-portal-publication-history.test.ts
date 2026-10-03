import { describe, expect, it, vi } from 'vitest'
import { getPortalPublicationHistory } from './get-portal-publication-history'
import { publicationSource } from '../../domain/__fixtures__/publication-source'
import { buildPortalPublicationSnapshot } from '../portal-publication-snapshot'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalActorDirectory } from '../ports/portal-actor-directory.port'
import { userId, type PropertyId, type UserId } from '#/shared/domain/ids'

const NOW = new Date('2026-08-26T14:00:00.000Z')
const portal = buildTestPortal({ publicationState: 'published' })
const ctx = buildTestAuthContext()
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

/** Names two of the people the fixtures use; anyone else is unknown to the directory. */
const NAMES: ReadonlyMap<string, string> = new Map([
  ['manager-1', 'Georgi Ivanov'],
  ['manager-2', 'Elena Petrova'],
])
const actorDirectory: PortalActorDirectory = {
  resolveDisplayNames: vi.fn(async (_org, ids: readonly UserId[]) => {
    const found = new Map<UserId, string>()
    for (const id of ids) {
      const name = NAMES.get(id)
      if (name !== undefined) found.set(userId(id), name)
    }
    return found
  }),
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
  }>,
) {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const versionOne = publishedSnapshot(1, portal.slug)
  const versionTwo = publishedSnapshot(2, 'second-published-address')
  const listActivationHistoryPage = vi.fn<
    PortalPublicationRepository['listActivationHistoryPage']
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
    return {
      records,
      latest: records[0],
      current: records[0],
      nextCursor: 1,
    }
  })
  const publicationRepo = {
    loadWorkingCopy: vi.fn(async () => ({
      ...source,
      portal: { ...source.portal, slug: options?.workingSlug ?? portal.slug },
    })),
    listActivationHistoryPage,
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
      actorDirectory,
    }),
    publicationRepo,
    listActivationHistoryPage,
  }
}

function setupLocalized(options?: Readonly<{ workingDisplayName?: string }>) {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
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
    listActivationHistoryPage: vi.fn(async () => ({
      records: [record],
      latest: record,
      current: record,
      nextCursor: null,
    })),
  } as unknown as PortalPublicationRepository

  return getPortalPublicationHistory({
    portalRepo,
    publicationRepo,
    staffPublicApi: peopleApi(),
    actorDirectory,
  })
}

describe('getPortalPublicationHistory', () => {
  it('returns the live rollback separately from earlier property-scoped activity', async () => {
    const harness = setup()

    await expect(harness.useCase({ portalId: portal.id }, ctx)).resolves.toEqual({
      current: {
        activationSequence: 3,
        version: 1,
        kind: 'rollback',
        activatedBy: { userId: 'manager-2', displayName: 'Elena Petrova' },
        activatedAt: NOW.toISOString(),
        deactivatedAt: null,
        deactivationReason: null,
      },
      priorActivations: [
        {
          activationSequence: 2,
          version: 2,
          kind: 'publish',
          activatedBy: { userId: 'manager-1', displayName: 'Georgi Ivanov' },
          activatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
          deactivatedAt: NOW.toISOString(),
          deactivationReason: 'replaced',
        },
      ],
      hasPendingChanges: false,
      pendingChanges: [],
      nextCursor: 1,
    })
    expect(harness.listActivationHistoryPage).toHaveBeenCalledWith(
      ctx.organizationId,
      portal.propertyId,
      portal.id,
      { beforeSequence: null, limit: 20 },
    )
  })

  it('passes a bounded exclusive cursor to the repository', async () => {
    const harness = setup()

    await harness.useCase({ portalId: portal.id, cursor: 2, limit: 1 }, ctx)

    expect(harness.listActivationHistoryPage).toHaveBeenCalledWith(
      ctx.organizationId,
      portal.propertyId,
      portal.id,
      { beforeSequence: 2, limit: 1 },
    )
  })

  it('marks saved content as pending when it differs from the live rollback', async () => {
    const harness = setup({ workingSlug: 'a-saved-address-for-the-next-publication' })

    const result = await harness.useCase({ portalId: portal.id }, ctx)

    expect(result.hasPendingChanges).toBe(true)
    expect(result.current).toMatchObject({ version: 1, kind: 'rollback' })
  })

  it('surfaces a durable pending change even when the resolved content still matches', async () => {
    const harness = setup({ durablePending: true })

    const result = await harness.useCase({ portalId: portal.id }, ctx)

    expect(result).toMatchObject({
      hasPendingChanges: true,
      pendingChanges: [
        {
          kind: 'property_brand_content',
          key: 'bg',
          changedAt: NOW.toISOString(),
          changedBy: { userId: 'manager-2', displayName: 'Elena Petrova' },
        },
        {
          kind: 'portal_links',
          key: 'all',
          changedAt: NOW.toISOString(),
          changedBy: null,
        },
      ],
    })
  })

  it('names a publisher the directory cannot name without exposing anything else', async () => {
    const harness = setup()
    vi.mocked(actorDirectory.resolveDisplayNames).mockResolvedValueOnce(new Map())

    const result = await harness.useCase({ portalId: portal.id }, ctx)

    expect(result.current?.activatedBy).toEqual({
      userId: 'manager-2',
      displayName: null,
    })
  })

  it('asks the directory once, for the people behind the page and the open changes', async () => {
    const harness = setup({ durablePending: true })
    vi.mocked(actorDirectory.resolveDisplayNames).mockClear()

    await harness.useCase({ portalId: portal.id }, ctx)

    expect(actorDirectory.resolveDisplayNames).toHaveBeenCalledTimes(1)
    const [, ids] = vi.mocked(actorDirectory.resolveDisplayNames).mock.calls[0] ?? []
    expect([...(ids ?? [])].sort()).toEqual(['manager-1', 'manager-2'])
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
    const propertyManager = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      harness.useCase({ portalId: portal.id }, propertyManager),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(harness.publicationRepo.loadWorkingCopy).not.toHaveBeenCalled()
    expect(harness.listActivationHistoryPage).not.toHaveBeenCalled()
  })
})
