// Test-only: the world and harness the Review & publish read suites share. The real
// use case runs over in-memory stand-ins for the repositories it reads.

import { vi } from 'vitest'
import { getPortalReview } from './get-portal-review.server'
import { createPortalReadsWorld } from '../infrastructure/testing/portal-reads-world'
import { userId, type PropertyId, type UserId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import { publicationSource } from '../domain/__fixtures__/publication-source'
import type { PortalPublicationSource } from '../domain/portal-publication-source'
import { PROPERTY_LOOK_SOURCES, type PortalLookSources } from '../domain/portal-look'
import type { Portal } from '../domain/types'
import { buildPortalPublicationSnapshot } from './portal-publication-snapshot.server'
import { buildLegacyPortalPublicationSnapshot } from './legacy-snapshot-builder.test-fixtures'
import type { PortalActorDirectory } from '../workspace/portal-actor-directory.port.server'
import type {
  PortalHistoryRepository,
  PortalPageEditRow,
} from '../workspace/portal-history-repository.port.server'
import type { PortalExperienceRepository } from '../editor/portal-experience-repository.port.server'
import type { PortalLinkRepository } from '../links/portal-link-repository.port.server'
import type {
  PortalPendingContentChange,
  PortalPublicationRepository,
} from './portal-publication-repository.port.server'

export const world = createPortalReadsWorld('review')

export const NOW = new Date('2026-09-30T12:00:00.000Z')
export const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)
export const LIVE_AT = minutesAgo(24 * 60)
export const LINK = '30000000-0000-4000-8000-000000000001'

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

export const pageEdit = (
  overrides: Partial<PortalPageEditRow> = {},
): PortalPageEditRow => ({
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

export type Options = Readonly<{
  state?: Portal['publicationState']
  workingCopy?: Partial<PortalPublicationSource>
  /** Where the Portal's look groups come from; the whole Property look by default. */
  lookSources?: PortalLookSources
  /** An earlier-design (v1) live version instead of a matching v3 one. */
  liveIsEarlierDesign?: boolean
  /** The live version has no activation record although the Portal is Published. */
  noLiveRecord?: boolean
  edits?: readonly PortalPageEditRow[]
  pending?: readonly PortalPendingContentChange[]
  propertyActive?: boolean
  destination?: 'verified' | 'unavailable' | 'relinked'
  /** `older`: a live code made before access artifacts (it works; its scans are not counted). */
  hasAddress?: boolean | 'older'
  responsibilityNeededSince?: Date | null
  additionalLocales?: Portal['additionalGuestLocales']
  accessible?: readonly PropertyId[] | null
  nextVersion?: number
  /** The live version's number (lower than the newest when an older one was made live again). */
  liveVersion?: number
  role?: 'AccountAdmin' | 'PropertyManager' | 'Member'
  readOnly?: boolean
}>

export async function setup(options: Options = {}) {
  const portal = world.portal({
    publicationState: options.state ?? 'published',
    responsibilityNeededSince: options.responsibilityNeededSince ?? null,
    additionalGuestLocales: options.additionalLocales ?? [],
    createdAt: minutesAgo(10 * 24 * 60),
  })
  const portalRepo = world.portalRepo()
  await world.seed([portal])
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
    loadWorkingCopyWithLook: vi.fn(async () => ({
      source: source(options.workingCopy),
      lookSources: options.lookSources ?? PROPERTY_LOOK_SOURCES,
    })),
    getCursor: vi.fn(async () => ({
      nextSnapshotVersion: options.nextVersion ?? 5,
      nextActivationSequence: 5,
    })),
    findLiveRecord: vi.fn(async () =>
      published && !options.noLiveRecord ? liveRecord : null,
    ),
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
              hasPublishedAccessArtifact: options.hasAddress !== 'older',
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
    ctx: world.ctx({
      role: options.role ?? 'PropertyManager',
      ...(options.readOnly
        ? {
            effectivePermissions: new Set(['portal.read'] as const),
            scopeByPermission: new Map([['portal.read', 'organization']] as const),
          }
        : {}),
    }),
  }
}

/** The review a caller sees for a Portal set up with these options. */
export async function listed(options: Options = {}) {
  const harness = await setup(options)
  return harness.useCase({ portalId: harness.portal.id }, harness.ctx)
}

/** An open pending content change, as the publication fence records it. */
export const openChange = (
  kind: PortalPendingContentChange['kind'],
  changedAt: Date,
  changedBy: string,
): PortalPendingContentChange => ({
  kind,
  key: 'all',
  sourceVersion: 'v1',
  changedAt,
  changedBy,
})
