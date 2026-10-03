// Portal context — the Review & publish read (round 4, slice 31).

import { describe, expect, it, vi } from 'vitest'
import { getPortalReview } from './get-portal-review'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { userId, type PropertyId, type UserId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { publicationSource } from '../../domain/__fixtures__/publication-source'
import type { PortalPublicationSource } from '../../domain/portal-publication-source'
import type { Portal } from '../../domain/types'
import { buildPortalPublicationSnapshot } from '../portal-publication-snapshot'
import { buildLegacyPortalPublicationSnapshot } from '../__fixtures__/legacy-snapshot-builder'
import type { PortalActorDirectory } from '../ports/portal-actor-directory.port'
import type {
  PortalHistoryRepository,
  PortalPageEditRow,
} from '../ports/portal-history.repository'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'
import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type {
  PortalPendingContentChange,
  PortalPublicationRepository,
} from '../ports/portal-publication.repository'

const NOW = new Date('2026-09-30T12:00:00.000Z')
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)
const LIVE_AT = minutesAgo(24 * 60)
const LINK = '30000000-0000-4000-8000-000000000001'

const DESTINATION = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=review-test',
  retrievedAt: NOW,
  sourceEpoch: 1,
  profileVersion: 1,
} as const
const RELINKED = {
  ...DESTINATION,
  retrievedAt: new Date(NOW.getTime() + 1_000),
  sourceEpoch: 2,
  profileVersion: 2,
} as const

const NAMES: ReadonlyMap<string, string> = new Map([
  ['georgi', 'Georgi Ivanov'],
  ['elena', 'Elena Petrova'],
])

const staffPublicApi = (accessible: readonly PropertyId[] | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const pageEdit = (overrides: Partial<PortalPageEditRow> = {}): PortalPageEditRow => ({
  editId: 'edit-1',
  kind: 'portal_links',
  key: `link:${LINK}:updated`,
  actorUserId: 'georgi',
  occurredAt: minutesAgo(60),
  propertyWide: false,
  previousText: null,
  newText: null,
  editCount: 1,
  ...overrides,
})

type Options = Readonly<{
  state?: Portal['publicationState']
  workingCopy?: Partial<PortalPublicationSource>
  /** An earlier-design (v1) live version instead of a matching v3 one. */
  liveIsEarlierDesign?: boolean
  /** The live version has no activation record although the Portal is Published. */
  noLiveRecord?: boolean
  edits?: readonly PortalPageEditRow[]
  pending?: readonly PortalPendingContentChange[]
  propertyActive?: boolean
  destination?: 'verified' | 'unavailable' | 'relinked'
  hasAddress?: boolean
  responsibilityNeededSince?: Date | null
  additionalLocales?: Portal['additionalGuestLocales']
  accessible?: readonly PropertyId[] | null
  nextVersion?: number
  /** The live version's number (lower than the newest when an older one was made live again). */
  liveVersion?: number
  role?: 'AccountAdmin' | 'PropertyManager' | 'Member'
}>

function setup(options: Options = {}) {
  const portal = buildTestPortal({
    publicationState: options.state ?? 'published',
    responsibilityNeededSince: options.responsibilityNeededSince ?? null,
    additionalGuestLocales: options.additionalLocales ?? [],
    createdAt: minutesAgo(10 * 24 * 60),
  })
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const source = (overrides: Partial<PortalPublicationSource> = {}) =>
    publicationSource({
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portal: { id: portal.id, name: portal.name, slug: portal.slug },
      privateFeedbackThreshold: portal.privateFeedbackThreshold,
      localeSet: ['en'],
      ...overrides,
    })
  const liveSnapshot = options.liveIsEarlierDesign
    ? buildLegacyPortalPublicationSnapshot({
        id: 'snapshot-legacy',
        portalId: portal.id,
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        version: options.liveVersion ?? 4,
        source: {
          portal: {
            id: portal.id,
            name: portal.name,
            slug: portal.slug,
            description: null,
            heroImageUrl: null,
            theme: null,
            organizationName: 'Example Organisation',
          },
          categories: [],
          links: [],
          privateFeedbackThreshold: 3,
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
        },
        destination: DESTINATION,
        createdBy: 'georgi',
        createdAt: LIVE_AT,
      })
    : buildPortalPublicationSnapshot({
        id: 'snapshot-live',
        portalId: portal.id,
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        version: options.liveVersion ?? 4,
        source: source(),
        destination: DESTINATION,
        createdBy: 'georgi',
        createdAt: LIVE_AT,
      })
  const liveRecord = {
    activation: {
      id: 'activation-4',
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      snapshotId: liveSnapshot.id,
      activationSequence: 4,
      kind: 'publish' as const,
      activatedBy: 'georgi',
      activatedAt: LIVE_AT,
      deactivatedAt: null,
      deactivationReason: null,
    },
    snapshot: liveSnapshot,
  }
  const published = (options.state ?? 'published') === 'published'
  const publicationRepo = {
    loadWorkingCopy: vi.fn(async () => source(options.workingCopy)),
    getCursor: vi.fn(async () => ({
      nextSnapshotVersion: options.nextVersion ?? 5,
      nextActivationSequence: 5,
    })),
    listActivationHistoryPage: vi.fn(async () => ({
      records: published && !options.noLiveRecord ? [liveRecord] : [],
      latest: published && !options.noLiveRecord ? liveRecord : null,
      current: published && !options.noLiveRecord ? liveRecord : null,
      nextCursor: null,
    })),
    listOpenPendingContentChanges: vi.fn(async () => options.pending ?? []),
  } as unknown as PortalPublicationRepository
  const historyRepo = {
    listPageEdits: vi.fn(async () => options.edits ?? []),
  } as unknown as PortalHistoryRepository
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
  const portalLinkRepo = {
    listAllLinks: async () => [],
    listLinkTexts: async () => [],
  } as unknown as PortalLinkRepository
  const experienceRepo = {
    getPropertyExperience: async () => ({
      profile: null,
      content: [
        {
          id: 'content-en',
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
          locale: 'en',
          title: 'Avela',
          shortDescription: 'Avela description',
          version: 1,
          updatedBy: userId('georgi'),
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    }),
    listPortalOverrides: async () => [],
  } as unknown as PortalExperienceRepository
  const deps = {
    portalRepo,
    portalLinkRepo,
    experienceRepo,
    publicationRepo,
    historyRepo,
    actorDirectory,
    portalTokenRepo: {
      findResolvableSummaryForPortal: async () =>
        options.hasAddress === false
          ? null
          : {
              version: 1,
              issuedAt: NOW,
              gracePeriodEnds: null,
              hasPublishedAccessArtifact: true,
              addressKeyVersion: null,
              issuedBy: null,
            },
    },
    propertyGoogleReviewDestinationApi: {
      getGoogleReviewDestination: async () =>
        options.destination === 'unavailable'
          ? {
              state: 'unavailable' as const,
              uri: null,
              retrievedAt: null,
              sourceEpoch: null,
              profileVersion: null,
            }
          : options.destination === 'relinked'
            ? RELINKED
            : DESTINATION,
    },
    propertyLifecycleApi: {
      isPropertyActive: async () => options.propertyActive ?? true,
    },
    staffPublicApi: staffPublicApi(options.accessible ?? null),
    clock: () => NOW,
  }
  return {
    portal,
    deps,
    publicationRepo,
    historyRepo,
    actorDirectory,
    useCase: getPortalReview(deps),
    ctx: buildTestAuthContext({ role: options.role ?? 'PropertyManager' }),
  }
}

describe('getPortalReview', () => {
  it('lists what guests will see change, oldest first, with who made each change', async () => {
    const harness = setup({
      pending: [
        {
          kind: 'portal_links',
          key: 'all',
          sourceVersion: 'v1',
          changedAt: minutesAgo(24 * 60 - 5),
          changedBy: 'georgi',
        },
      ],
      edits: [
        pageEdit({
          editId: 'edit-2',
          kind: 'property_brand_content',
          key: 'es',
          propertyWide: true,
          actorUserId: 'elena',
          occurredAt: minutesAgo(120),
          previousText: 'Zona de piscina',
          newText: 'Piscina y terraza',
        }),
        pageEdit({
          editId: 'edit-1',
          key: `link:${LINK}:text:en`,
          occurredAt: minutesAgo(24 * 60 - 5),
          previousText: 'Dinner menu',
          newText: 'Olive Terrace menu',
        }),
      ],
      workingCopy: { privateFeedbackThreshold: 4 },
    })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review).toMatchObject({
      portalId: harness.portal.id,
      publicationState: 'published',
      action: 'publish_changes',
      live: {
        version: 4,
        activatedAt: LIVE_AT.toISOString(),
        activatedBy: { userId: 'georgi', displayName: 'Georgi Ivanov' },
      },
      publishesAsVersion: 5,
      nothingToPublish: false,
      canPublish: true,
      changesMayBeIncomplete: false,
    })
    expect(review.changes).toEqual([
      {
        type: 'edit',
        kind: 'portal_links',
        subject: { area: 'link_text', linkId: LINK, locale: 'en' },
        propertyWide: false,
        actor: { userId: 'georgi', displayName: 'Georgi Ivanov' },
        occurredAt: minutesAgo(24 * 60 - 5).toISOString(),
        previousText: 'Dinner menu',
        newText: 'Olive Terrace menu',
        editCount: 1,
      },
      {
        type: 'edit',
        kind: 'property_brand_content',
        subject: { area: 'welcome_text', locale: 'es' },
        propertyWide: true,
        actor: { userId: 'elena', displayName: 'Elena Petrova' },
        occurredAt: minutesAgo(120).toISOString(),
        previousText: 'Zona de piscina',
        newText: 'Piscina y terraza',
        editCount: 1,
      },
    ])
  })

  it('does not list edits that went into the live version', async () => {
    const harness = setup({
      pending: [
        {
          kind: 'portal_links',
          key: 'all',
          sourceVersion: 'v1',
          changedAt: minutesAgo(5),
          changedBy: 'elena',
        },
      ],
      edits: [
        pageEdit({ editId: 'new', occurredAt: minutesAgo(5), actorUserId: 'elena' }),
        // The same instant as the publication: the publication took it.
        pageEdit({
          editId: 'at-publication',
          key: `link:${LINK}:deleted`,
          occurredAt: LIVE_AT,
        }),
        pageEdit({
          editId: 'old',
          key: `link:${LINK}:created`,
          occurredAt: new Date(LIVE_AT.getTime() - 1),
        }),
      ],
    })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review.changes).toHaveLength(1)
    expect(review.changes[0]).toMatchObject({
      type: 'edit',
      subject: { area: 'link', linkId: LINK, change: 'updated' },
    })
  })

  it('lists every edit made since the live version when an older version was made live again', async () => {
    // v3 is live again after v5 was published an hour ago: every edit since v3
    // is still in the draft and publishing puts it in front of guests, the ones
    // v5 took included. The review measures from v3, not from v5.
    const harness = setup({
      liveVersion: 3,
      workingCopy: { privateFeedbackThreshold: 4 },
      pending: [
        {
          kind: 'portal_links',
          key: 'all',
          sourceVersion: 'v1',
          changedAt: minutesAgo(10),
          changedBy: 'georgi',
        },
      ],
      edits: [
        pageEdit({
          editId: 'after-v5',
          key: `link:${LINK}:text:en`,
          occurredAt: minutesAgo(10),
          previousText: 'Dinner menu',
          newText: 'Olive Terrace menu',
        }),
        pageEdit({
          editId: 'between',
          kind: 'property_brand_content',
          key: 'es',
          propertyWide: true,
          actorUserId: 'elena',
          occurredAt: minutesAgo(120),
          previousText: 'Zona de piscina',
          newText: 'Piscina y terraza',
        }),
      ],
    })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review.live?.version).toBe(3)
    expect(review.changes).toMatchObject([
      { type: 'edit', kind: 'property_brand_content', previousText: 'Zona de piscina' },
      { type: 'edit', kind: 'portal_links', previousText: 'Dinner menu' },
    ])
  })

  it('does not fall back to an unlisted change after an older version was made live again', async () => {
    const harness = setup({
      liveVersion: 3,
      workingCopy: { privateFeedbackThreshold: 4 },
      edits: [
        pageEdit({
          key: 'settings:name',
          kind: 'portal_configuration',
          occurredAt: minutesAgo(120),
          previousText: 'Pool',
          newText: 'Pool & Terrace',
        }),
      ],
    })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review.changes).toMatchObject([{ type: 'edit', kind: 'portal_configuration' }])
  })

  it('does not offer to publish to someone who may only read the Portal', async () => {
    const harness = setup({
      role: 'Member',
      workingCopy: { privateFeedbackThreshold: 4 },
    })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review.canPublish).toBe(false)
    expect(review.action).toBe('publish_changes')
    expect(review.nothingToPublish).toBe(false)
    expect(review.checkCounts.blocked).toBe(0)
  })

  it('does not offer to publish when the publish capability is dark for this Portal', async () => {
    const harness = setup({ workingCopy: { privateFeedbackThreshold: 4 } })

    const review = await harness.useCase(
      { portalId: harness.portal.id, mayPublish: false },
      harness.ctx,
    )

    expect(review.canPublish).toBe(false)
    expect(review.checkCounts.blocked).toBe(0)
  })

  it('reads the ledger bounded to the repository page, for this Portal', async () => {
    const harness = setup()

    await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(harness.historyRepo.listPageEdits).toHaveBeenCalledWith(
      harness.portal.organizationId,
      harness.portal.propertyId,
      harness.portal.id,
      { bound: null, limit: 100 },
      harness.portal.createdAt,
    )
  })

  it('says the list may be incomplete when the ledger page is full of newer edits', async () => {
    const edits = Array.from({ length: 100 }, (_, index) =>
      pageEdit({
        editId: `edit-${index}`,
        key: `link:${LINK}:text:en`,
        occurredAt: minutesAgo(index + 1),
        newText: `Text ${index}`,
      }),
    )
    const harness = setup({ edits })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review.changesMayBeIncomplete).toBe(true)
  })

  it('has nothing to publish when the draft is what is live and nothing is open', async () => {
    const harness = setup()

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review).toMatchObject({
      nothingToPublish: true,
      canPublish: false,
      changes: [],
      action: 'publish_changes',
    })
  })

  it('names the move to the new design when the live version is the earlier one', async () => {
    const harness = setup({ liveIsEarlierDesign: true })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review.nothingToPublish).toBe(false)
    expect(review.changes.map((change) => change.type)).toEqual(['earlier_design'])
    expect(review.canPublish).toBe(true)
  })

  it('names a Google address the Property has moved on from', async () => {
    const harness = setup({ destination: 'relinked' })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review.nothingToPublish).toBe(false)
    expect(review.changes).toEqual([{ type: 'google_destination_moved' }])
  })

  it('names who made a recorded change the ledger has no row for', async () => {
    const harness = setup({
      pending: [
        {
          kind: 'approved_destination',
          key: 'all',
          sourceVersion: 'v1',
          changedAt: minutesAgo(30),
          changedBy: 'elena',
        },
      ],
    })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review.changes).toEqual([
      {
        type: 'unrecorded',
        kind: 'approved_destination',
        actor: { userId: 'elena', displayName: 'Elena Petrova' },
        occurredAt: minutesAgo(30).toISOString(),
      },
    ])
  })

  it('reports every gate the publish use case would refuse, without throwing', async () => {
    const harness = setup({
      propertyActive: false,
      destination: 'unavailable',
      hasAddress: false,
      responsibilityNeededSince: minutesAgo(10),
      workingCopy: { privateFeedbackThreshold: 4 },
    })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review.canPublish).toBe(false)
    expect(review.checkCounts).toEqual({ blocked: 4, warning: 0, passed: 3 })
    expect(review.checks.slice(0, 4).map((check) => check.code)).toEqual([
      'property_available',
      'google_destination',
      'responsible_manager',
      'public_address',
    ])
  })

  it('blocks on a primary-language text nobody wrote, and passes nothing the resolver refused', async () => {
    const harness = setup({
      workingCopy: {
        wording: {
          en: {
            title: '',
            shortDescription: 'Rate your visit.',
            heroAlt: null,
            linktreeTitle: null,
          },
        },
        privateFeedbackThreshold: 4,
      },
    })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review.canPublish).toBe(false)
    expect(review.checks).toContainEqual({
      code: 'primary_text',
      status: 'blocked',
      locale: 'en',
      keys: ['title'],
    })
  })

  it('warns about a text copied from the fallback language, and counts AI drafts per language', async () => {
    const harness = setup({
      additionalLocales: ['bg'],
      workingCopy: {
        localeSet: ['en', 'bg'],
        wording: {
          en: {
            title: 'Avela',
            shortDescription: 'Rate your visit.',
            heroAlt: null,
            linktreeTitle: null,
          },
        },
        links: [
          {
            id: LINK,
            url: 'https://harbor.example.com/menu',
            iconKey: null,
            imageAssetId: null,
            texts: {
              en: { label: 'Menu', line: null, provenance: null },
              bg: { label: 'Меню', line: null, provenance: 'ai_draft' },
            },
          },
        ],
        privateFeedbackThreshold: 4,
      },
    })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review.canPublish).toBe(true)
    expect(review.checkCounts.warning).toBe(1)
    expect(review.checks).toContainEqual({
      code: 'copied_text',
      status: 'warning',
      locale: 'bg',
      keys: ['title', 'shortDescription'],
    })
    const bulgarian = review.languages.find((row) => row.locale === 'bg')
    expect(bulgarian).toMatchObject({ aiDraftCount: 1, status: 'copied_from_fallback' })
    expect(review.languages.find((row) => row.locale === 'en')).toMatchObject({
      isFallback: true,
      aiDraftCount: 0,
    })
  })

  it('reviews a first publication without a change list, and offers to publish', async () => {
    const harness = setup({
      state: 'draft',
      edits: [pageEdit()],
      pending: [
        {
          kind: 'portal_links',
          key: 'all',
          sourceVersion: 'v1',
          changedAt: minutesAgo(1),
          changedBy: 'georgi',
        },
      ],
    })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review).toMatchObject({
      publicationState: 'draft',
      action: 'publish',
      live: null,
      nothingToPublish: false,
      canPublish: true,
      changes: [],
      publishesAsVersion: 5,
    })
  })

  it('offers nothing for an archived Portal', async () => {
    const harness = setup({ state: 'archived' })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review).toMatchObject({ action: 'none', canPublish: false })
  })

  it('refuses a Published Portal that has no live version, as publishing does', async () => {
    const harness = setup({ noLiveRecord: true })

    await expect(
      harness.useCase({ portalId: harness.portal.id }, harness.ctx),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
  })

  it('refuses when the working copy cannot be read', async () => {
    const harness = setup()
    vi.mocked(harness.publicationRepo.loadWorkingCopy).mockResolvedValueOnce(null)

    await expect(
      harness.useCase({ portalId: harness.portal.id }, harness.ctx),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
  })

  it('checks property access before reading anything about the Portal', async () => {
    const harness = setup({ accessible: [] })

    await expect(
      harness.useCase({ portalId: harness.portal.id }, harness.ctx),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(harness.publicationRepo.loadWorkingCopy).not.toHaveBeenCalled()
    expect(harness.historyRepo.listPageEdits).not.toHaveBeenCalled()
  })

  it('names the people behind the page with one directory call', async () => {
    const harness = setup({
      edits: [pageEdit({ actorUserId: 'elena' })],
      pending: [
        {
          kind: 'portal_links',
          key: 'all',
          sourceVersion: 'v1',
          changedAt: minutesAgo(5),
          changedBy: 'elena',
        },
      ],
    })

    await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(harness.actorDirectory.resolveDisplayNames).toHaveBeenCalledTimes(1)
    const [, ids] =
      vi.mocked(harness.actorDirectory.resolveDisplayNames).mock.calls[0] ?? []
    expect([...(ids ?? [])].sort()).toEqual(['elena', 'georgi'])
  })
})
