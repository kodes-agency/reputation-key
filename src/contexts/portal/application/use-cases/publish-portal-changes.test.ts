// Portal context — publish changes while live

import { describe, expect, it } from 'vitest'
import { publishPortalChanges, publishPortalsChanges } from './publish-portal-changes'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { portalError } from '../../domain/errors'
import { buildPortalPublicationSnapshot } from '../portal-publication-snapshot'
import { publicationSource } from '../../domain/__fixtures__/publication-source'
import type { PortalPublicationSource } from '../../domain/portal-publication-source'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type {
  RepublishPortalCommand,
  UpdatePortalCommand,
} from '../ports/portal-command-store.port'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { Portal } from '../../domain/types'

const NOW = new Date('2026-09-30T12:00:00.000Z')
const DESTINATION = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=test',
  retrievedAt: NOW,
  sourceEpoch: 1,
  profileVersion: 1,
} as const

const RELINKED_DESTINATION = {
  ...DESTINATION,
  retrievedAt: new Date(NOW.getTime() + 1_000),
  sourceEpoch: DESTINATION.sourceEpoch + 1,
  profileVersion: DESTINATION.profileVersion + 1,
} as const

const staffPublicApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

function workingCopyOf(portal: Portal, overrides: Partial<PortalPublicationSource> = {}) {
  return publicationSource({
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    portal: { id: portal.id, name: portal.name, slug: portal.slug },
    privateFeedbackThreshold: portal.privateFeedbackThreshold,
    ...overrides,
  })
}

function liveSnapshotOf(portal: Portal, source: PortalPublicationSource) {
  return buildPortalPublicationSnapshot({
    id: 'snapshot-v2',
    portalId: portal.id,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    version: 2,
    source,
    destination: DESTINATION,
    createdBy: 'manager-1',
    createdAt: new Date(NOW.getTime() - 60_000),
  })
}

type Options = Readonly<{
  state?: Portal['publicationState']
  /** What the working copy says now; the live version says the default. */
  workingCopy?: Partial<PortalPublicationSource>
  /** The address the draft has moved to, which the live version does not have. */
  draftSlug?: string
  live?: 'matching' | 'none'
  openChanges?: number
  propertyActive?: boolean
  /** `relinked`: Google was disconnected and linked again, so the Property's destination moved on. */
  destination?: 'verified' | 'unavailable' | 'relinked'
  hasAddress?: boolean
  responsibilityNeededSince?: Date | null
}>

function setup(options: Options = {}) {
  const portal = buildTestPortal({
    publicationState: options.state ?? 'published',
    responsibilityNeededSince: options.responsibilityNeededSince ?? null,
  })
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const outbox = createRecordedOutbox()
  const baseStore = createInMemoryPortalCommandStore({ portalRepo, outbox })
  const commands: RepublishPortalCommand[] = []
  const updates: UpdatePortalCommand[] = []
  const liveSource = workingCopyOf(portal)
  const live = options.live === 'none' ? null : liveSnapshotOf(portal, liveSource)
  const publicationRepo: PortalPublicationRepository = {
    countOpenPendingContentChanges: async () => [],
    loadWorkingCopy: async () =>
      workingCopyOf(portal, {
        ...(options.draftSlug
          ? { portal: { id: portal.id, name: portal.name, slug: options.draftSlug } }
          : {}),
        ...options.workingCopy,
      }),
    getCursor: async () => ({ nextSnapshotVersion: 3, nextActivationSequence: 4 }),
    findSnapshotByVersion: async () => null,
    findActiveForPortal: async () => live,
    listActivationHistoryPage: async () => ({
      records: [],
      latest: null,
      current: null,
      nextCursor: null,
    }),
    listActivationsBetween: async () => [],
    listOpenPendingContentChanges: async () =>
      Array.from({ length: options.openChanges ?? 0 }, (_, index) => ({
        kind: 'portal_links' as const,
        key: `link:${index}`,
        sourceVersion: NOW.toISOString(),
        changedAt: NOW,
      })),
    resolveActiveByTokenDigest: async () => null,
  }
  let ids = 0
  const deps = {
    portalRepo,
    commandStore: {
      ...baseStore,
      republishPortal: async (command: RepublishPortalCommand) => {
        commands.push(command)
        await baseStore.republishPortal(command)
      },
      updatePortal: async (command: UpdatePortalCommand) => {
        updates.push(command)
        await baseStore.updatePortal(command)
      },
    },
    publicationRepo,
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
            ? RELINKED_DESTINATION
            : DESTINATION,
    },
    propertyLifecycleApi: {
      isPropertyActive: async () => options.propertyActive ?? true,
    },
    staffPublicApi,
    idGen: () => `generated-${(ids += 1)}`,
    clock: () => NOW,
  }
  return {
    portal,
    portalRepo,
    outbox,
    commands,
    updates,
    live,
    deps,
    useCase: publishPortalChanges(deps),
  }
}

const FIRST_PORTAL_ID = 'd0000000-0000-0000-0000-000000000001'

const manager = () => buildTestAuthContext({ role: 'PropertyManager' })

describe('publishPortalChanges', () => {
  it('replaces the live version with a new immutable one when the draft has moved', async () => {
    const harness = setup({ draftSlug: 'new-address' })
    const ctx = manager()

    const result = await harness.useCase({ portalId: harness.portal.id }, ctx)

    expect(result).toMatchObject({
      outcome: 'published',
      version: 3,
      activatedAt: NOW,
    })
    const [command] = harness.commands
    expect(harness.commands).toHaveLength(1)
    expect(command).toMatchObject({
      organizationId: harness.portal.organizationId,
      propertyId: harness.portal.propertyId,
      portalId: harness.portal.id,
      actorUserId: ctx.userId,
      expectedUpdatedAt: harness.portal.updatedAt,
      occurredAt: NOW,
    })
    expect(command?.revision.getTime()).toBeGreaterThan(
      harness.portal.updatedAt.getTime(),
    )
    expect(command?.snapshot).toMatchObject({
      version: 3,
      createdBy: ctx.userId,
      createdAt: NOW,
      destinationUri: DESTINATION.uri,
    })
    expect(command?.snapshot.configurationDigest).not.toBe(
      harness.live?.configurationDigest,
    )
    expect(command?.activation).toMatchObject({
      kind: 'publish',
      snapshotId: command?.snapshot.id,
      activationSequence: 4,
      activatedBy: ctx.userId,
      activatedAt: NOW,
      deactivatedAt: null,
      deactivationReason: null,
    })
    expect(command?.event).toMatchObject({
      previousPublicationState: 'published',
      publicationState: 'published',
    })
  })

  it('records one publication fact that quotes the new snapshot and nothing of its content', async () => {
    const harness = setup({ openChanges: 2 })

    await harness.useCase({ portalId: harness.portal.id }, manager())

    const [command] = harness.commands
    expect(command?.lifecycleEvent).toMatchObject({
      _tag: 'portal.publication.published',
      publicationSnapshotId: command?.snapshot.id,
      publicationVersion: 3,
      publicationDigest: command?.snapshot.configurationDigest,
      userId: command?.actorUserId,
    })
    expect(harness.outbox.facts.map((event) => event._tag).sort()).toEqual([
      'portal.publication.published',
      'portal.updated',
    ])
    expect(JSON.stringify(harness.outbox.facts)).not.toContain(DESTINATION.uri)
  })

  it('does nothing when nothing is pending', async () => {
    const harness = setup()

    const result = await harness.useCase({ portalId: harness.portal.id }, manager())

    expect(result).toEqual({ outcome: 'unchanged', version: 2 })
    expect(harness.commands).toEqual([])
    expect(harness.outbox.facts).toEqual([])
  })

  it('republishes a draft that matches the live content when the Property destination was relinked', async () => {
    const harness = setup({ destination: 'relinked' })

    const result = await harness.useCase({ portalId: harness.portal.id }, manager())

    expect(result).toMatchObject({ outcome: 'published', version: 3 })
    expect(harness.commands).toHaveLength(1)
    expect(harness.commands[0]?.snapshot).toMatchObject({
      destinationUri: RELINKED_DESTINATION.uri,
      destinationRetrievedAt: RELINKED_DESTINATION.retrievedAt,
      destinationSourceEpoch: RELINKED_DESTINATION.sourceEpoch,
      destinationProfileVersion: RELINKED_DESTINATION.profileVersion,
    })
  })

  it('does nothing when the content and the pinned destination both still match', async () => {
    const harness = setup({ destination: 'verified' })

    await expect(
      harness.useCase({ portalId: harness.portal.id }, manager()),
    ).resolves.toEqual({ outcome: 'unchanged', version: 2 })
    expect(harness.commands).toEqual([])
  })

  it('still runs the readiness gates for a relink-only republish', async () => {
    const harness = setup({ destination: 'relinked', hasAddress: false })

    await expect(
      harness.useCase({ portalId: harness.portal.id }, manager()),
    ).rejects.toMatchObject({ code: 'token_unavailable' })
    expect(harness.commands).toEqual([])
  })

  it('publishes when only a recorded change is pending', async () => {
    const harness = setup({ openChanges: 1 })

    await expect(
      harness.useCase({ portalId: harness.portal.id }, manager()),
    ).resolves.toMatchObject({ outcome: 'published', version: 3 })
  })

  it('treats a live version of the earlier design as a pending change', async () => {
    const harness = setup()
    const legacyDraft = harness.deps.publicationRepo
    // A version 1 or 2 snapshot never matches a working copy: publishing writes version 3.
    const useCase = publishPortalChanges({
      ...harness.deps,
      publicationRepo: {
        ...legacyDraft,
        findActiveForPortal: async () => ({
          ...(harness.live as NonNullable<typeof harness.live>),
          configuration: {
            ...(harness.live as NonNullable<typeof harness.live>).configuration,
            schemaVersion: 2,
          } as never,
        }),
      },
    })

    await expect(
      useCase({ portalId: harness.portal.id }, manager()),
    ).resolves.toMatchObject({ outcome: 'published' })
  })

  it.each(['draft', 'disabled', 'archived'] as const)(
    'refuses a %s Portal, which publishing (not republishing) takes live',
    async (state) => {
      const harness = setup({ state, openChanges: 1 })

      await expect(
        harness.useCase({ portalId: harness.portal.id }, manager()),
      ).rejects.toMatchObject({ code: 'invalid_publication_transition' })
      expect(harness.commands).toEqual([])
    },
  )

  it('refuses a published Portal that has no live version to replace', async () => {
    const harness = setup({ live: 'none', openChanges: 1 })

    await expect(
      harness.useCase({ portalId: harness.portal.id }, manager()),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
    expect(harness.commands).toEqual([])
  })

  it('refuses a role that cannot edit Portals', async () => {
    const harness = setup({ openChanges: 1 })

    await expect(
      harness.useCase(
        { portalId: harness.portal.id },
        buildTestAuthContext({ role: 'Member' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses an unknown Portal', async () => {
    const harness = setup({ openChanges: 1 })

    await expect(
      harness.useCase({ portalId: 'missing' }, manager()),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })

  describe('readiness gates, the same as for a first publication', () => {
    it('needs an active Property', async () => {
      const harness = setup({ openChanges: 1, propertyActive: false })

      await expect(
        harness.useCase({ portalId: harness.portal.id }, manager()),
      ).rejects.toMatchObject({ code: 'portal_inactive' })
      expect(harness.commands).toEqual([])
    })

    it('needs a verified Google review destination', async () => {
      const harness = setup({ openChanges: 1, destination: 'unavailable' })

      await expect(
        harness.useCase({ portalId: harness.portal.id }, manager()),
      ).rejects.toMatchObject({ code: 'google_review_destination_unavailable' })
    })

    it('needs a responsible manager', async () => {
      const harness = setup({ openChanges: 1, responsibilityNeededSince: NOW })

      await expect(
        harness.useCase({ portalId: harness.portal.id }, manager()),
      ).rejects.toMatchObject({ code: 'responsible_manager_ineligible' })
    })

    it('needs a public address', async () => {
      const harness = setup({ openChanges: 1, hasAddress: false })

      await expect(
        harness.useCase({ portalId: harness.portal.id }, manager()),
      ).rejects.toMatchObject({ code: 'token_unavailable' })
    })

    it('stops at a blocker in the primary language, as a first publication does', async () => {
      const harness = setup({
        workingCopy: {
          wording: {
            en: {
              title: null,
              shortDescription: null,
              heroAlt: null,
              linktreeTitle: null,
            },
          },
          localeSet: ['en'],
        },
      })

      await expect(
        harness.useCase({ portalId: harness.portal.id }, manager()),
      ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
      expect(harness.commands).toEqual([])
    })

    it('asks nothing of a Portal with nothing to publish', async () => {
      const harness = setup({ propertyActive: false, destination: 'unavailable' })

      await expect(
        harness.useCase({ portalId: harness.portal.id }, manager()),
      ).resolves.toMatchObject({ outcome: 'unchanged' })
    })
  })

  it('never rewrites the Portal row itself: the store gets no patch and no state change', async () => {
    const harness = setup({ openChanges: 1 })

    await harness.useCase({ portalId: harness.portal.id }, manager())

    expect(harness.updates).toEqual([])
    const persisted = await harness.portalRepo.findById(
      harness.portal.organizationId,
      harness.portal.id,
    )
    expect(persisted?.publicationState).toBe('published')
  })
})

describe('publishPortalsChanges', () => {
  function batchSetup() {
    const first = setup({ openChanges: 1 })
    return first
  }

  it('publishes each Portal in order and reports the outcome per Portal', async () => {
    const harness = batchSetup()
    const batch = publishPortalsChanges(harness.deps)

    const results = await batch({ portalIds: [harness.portal.id, 'missing'] }, manager())

    expect(results).toEqual([
      expect.objectContaining({ portalId: harness.portal.id, outcome: 'published' }),
      expect.objectContaining({
        portalId: 'missing',
        outcome: 'failed',
        code: 'portal_not_found',
      }),
    ])
  })

  it('goes on after a Portal that cannot be published', async () => {
    const harness = batchSetup()
    const batch = publishPortalsChanges(harness.deps)

    const results = await batch({ portalIds: ['missing', harness.portal.id] }, manager())

    expect(results.map((result) => result.outcome)).toEqual(['failed', 'published'])
    expect(harness.commands).toHaveLength(1)
  })

  /** Two live Portals of one Property, each with a recorded change pending. */
  function twoPortals(
    overrides: Readonly<{
      republishFails?: (portalId: string) => boolean
      hasAddress?: (portalId: string) => boolean
    }> = {},
  ) {
    const harness = setup({ openChanges: 1 })
    const second = buildTestPortal({
      id: 'd0000000-0000-0000-0000-000000000002',
      slug: 'second-portal',
    })
    harness.portalRepo.seed([harness.portal, second])
    const portals = new Map([harness.portal, second].map((p) => [String(p.id), p]))
    const portalOf = (id: string) => {
      const found = portals.get(id)
      if (!found) throw new Error(`unknown portal ${id}`)
      return found
    }
    const baseStore = harness.deps.commandStore
    const deps = {
      ...harness.deps,
      publicationRepo: {
        ...harness.deps.publicationRepo,
        loadWorkingCopy: async (_org: unknown, id: unknown) =>
          workingCopyOf(portalOf(String(id))),
        findActiveForPortal: async (_org: unknown, id: unknown) =>
          liveSnapshotOf(portalOf(String(id)), workingCopyOf(portalOf(String(id)))),
      } as PortalPublicationRepository,
      portalTokenRepo: {
        findResolvableSummaryForPortal: async (_org: unknown, id: unknown) =>
          (overrides.hasAddress?.(String(id)) ?? true)
            ? {
                version: 1,
                issuedAt: NOW,
                gracePeriodEnds: null,
                hasPublishedAccessArtifact: true,
                addressKeyVersion: null,
              }
            : null,
      },
      commandStore: {
        ...baseStore,
        republishPortal: async (command: RepublishPortalCommand) => {
          if (overrides.republishFails?.(String(command.portalId))) {
            throw portalError('revision_conflict', 'Portal changed during command')
          }
          await baseStore.republishPortal(command)
        },
      },
    }
    return { first: harness.portal, second, deps, commands: harness.commands }
  }

  it('publishes two live Portals in the order given', async () => {
    const { first, second, deps, commands } = twoPortals()
    const batch = publishPortalsChanges(deps)

    const results = await batch({ portalIds: [second.id, first.id] }, manager())

    expect(results.map((r) => [r.portalId, r.outcome])).toEqual([
      [second.id, 'published'],
      [first.id, 'published'],
    ])
    expect(commands.map((command) => command.portalId)).toEqual([second.id, first.id])
  })

  it('goes on to the next Portal after a store conflict on the first', async () => {
    const { first, second, deps, commands } = twoPortals({
      republishFails: (id) => id === String(FIRST_PORTAL_ID),
    })
    const batch = publishPortalsChanges(deps)

    const results = await batch({ portalIds: [first.id, second.id] }, manager())

    expect(results).toEqual([
      expect.objectContaining({
        portalId: first.id,
        outcome: 'failed',
        code: 'revision_conflict',
      }),
      expect.objectContaining({ portalId: second.id, outcome: 'published' }),
    ])
    expect(commands.map((command) => command.portalId)).toEqual([second.id])
  })

  it('goes on to the next Portal after a readiness gate refuses the first', async () => {
    const { first, second, deps, commands } = twoPortals({
      hasAddress: (id) => id !== String(FIRST_PORTAL_ID),
    })
    const batch = publishPortalsChanges(deps)

    const results = await batch({ portalIds: [first.id, second.id] }, manager())

    expect(results).toEqual([
      expect.objectContaining({
        portalId: first.id,
        outcome: 'failed',
        code: 'token_unavailable',
      }),
      expect.objectContaining({ portalId: second.id, outcome: 'published' }),
    ])
    expect(commands.map((command) => command.portalId)).toEqual([second.id])
  })

  it('reports a Portal with nothing pending as unchanged', async () => {
    const harness = setup()
    const batch = publishPortalsChanges(harness.deps)

    await expect(batch({ portalIds: [harness.portal.id] }, manager())).resolves.toEqual([
      { portalId: harness.portal.id, outcome: 'unchanged', version: 2 },
    ])
  })

  it('names each Portal once, in the order given', async () => {
    const harness = batchSetup()
    const batch = publishPortalsChanges(harness.deps)

    const results = await batch(
      { portalIds: [harness.portal.id, harness.portal.id] },
      manager(),
    )

    expect(results).toHaveLength(1)
    expect(harness.commands).toHaveLength(1)
  })

  it('does not hide a fault that is not a Portal error', async () => {
    const harness = batchSetup()
    const batch = publishPortalsChanges({
      ...harness.deps,
      commandStore: {
        ...harness.deps.commandStore,
        republishPortal: async () => {
          throw new Error('connection reset')
        },
      },
    })

    await expect(batch({ portalIds: [harness.portal.id] }, manager())).rejects.toThrow(
      'connection reset',
    )
  })
})
