// Publish changes while live, preview them, make an earlier version live again
// and complete a content review, on real PostgreSQL with two organizations: the
// results a manager sees, the refusals, the snapshots and activations written
// and the facts recorded. The real use cases run over the real stores and
// command store; only the clock, the ids and the other contexts' answers (the
// Property's destination and lifecycle, the staff assignments) are fixed.

import { randomBytes, randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PropertyGoogleReviewDestinationPublicApi } from '#/contexts/property/application/public-api'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { getDb } from '#/shared/db'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  organizationId,
  portalId,
  propertyId,
  userId,
  type OrganizationId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildPortalPublicationSnapshot } from '../application/portal-publication-snapshot'
import { completeContentReview } from '../application/use-cases/complete-content-review'
import { issuePortalToken } from '../application/use-cases/issue-portal-token'
import {
  previewPortalChanges,
  publishPortalChanges,
  publishPortalsChanges,
} from '../application/use-cases/publish-portal-changes'
import { rollbackPortalPublication } from '../application/use-cases/rollback-portal-publication'
import { recordPortalPendingContentChange } from '../infrastructure/portal-pending-content-changes'
import { createPortalWorkflowFactStore } from '../infrastructure/portal-workflow-fact-store'
import { createPortalRepository } from '../infrastructure/repositories/portal.repository'
import { createPortalGroupRepository } from '../infrastructure/repositories/portal-group.repository'
import { createPortalPublicationRepository } from '../infrastructure/repositories/portal-publication.repository'
import { createPortalTokenRepository } from '../infrastructure/repositories/portal-token.repository'
import { seedLegacySnapshot } from '../infrastructure/testing/portal-legacy-live-seed'
import { testPortalTokenCodec } from '../infrastructure/testing/portal-token-codec-fixture'
import {
  publishFromSource,
  republishFromSource,
} from '../infrastructure/testing/portal-working-copy-publish'
import {
  seedPortalLookOverride,
  seedPortalWorkingCopy,
  seedSiblingPortal,
  type PortalWorkingCopySeed,
} from '../infrastructure/testing/portal-working-copy-seed'
import type { PortalCommandStore } from './portal-command-store-port.server'
import { createAtomicPortalCommandStore } from './portal-command-store.server'

const ORG_A = organizationId('org-publication-lifecycle-000001')
const ORG_B = organizationId('org-publication-lifecycle-000002')
const MANAGER = userId('manager-publication-lifecycle-001')
const NOW = new Date('2026-09-30T12:00:00.000Z')
const EDITED_AT = new Date('2026-09-01T09:00:00.000Z')
const LIVE_DESTINATION = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=working-copy',
  retrievedAt: new Date('2026-08-26T10:00:00.000Z'),
  sourceEpoch: 1,
  profileVersion: 1,
} as const
const RELINKED_DESTINATION = {
  ...LIVE_DESTINATION,
  retrievedAt: new Date(NOW.getTime() + 1_000),
  sourceEpoch: LIVE_DESTINATION.sourceEpoch + 1,
  profileVersion: LIVE_DESTINATION.profileVersion + 1,
} as const

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_address_downloads',
    'portal_access_artifacts',
    'portal_tokens',
    'portal_pending_content_changes',
    'portal_page_edits',
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_group_history',
    'portal_group_memberships',
    'portal_groups',
    'portal_localized_overrides',
    'portal_look_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_link_texts',
    'portal_links',
    'portal_media_assets',
    'portal_approved_destinations',
    'portal_link_categories',
    'outbox_events',
    'portals',
    'properties',
  ],
})

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

const ratingGoalGuard = createPortalRatingGoalGuard()
const publicationRepo = () => createPortalPublicationRepository(getDb())

type Destination = Awaited<
  ReturnType<PropertyGoogleReviewDestinationPublicApi['getGoogleReviewDestination']>
>
const UNAVAILABLE_DESTINATION: Destination = {
  state: 'unavailable',
  uri: null,
  retrievedAt: null,
  sourceEpoch: null,
  profileVersion: null,
}

type Options = Readonly<{
  accessible?: ReadonlyArray<PropertyId> | null
  destination?: Destination
  propertyActive?: boolean
  wrapStore?: (store: PortalCommandStore) => PortalCommandStore
}>

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

function wire(options: Options = {}) {
  const db = getDb()
  const baseStore = createAtomicPortalCommandStore(db, ratingGoalGuard)
  const destination = options.destination ?? LIVE_DESTINATION
  const destinationApi: PropertyGoogleReviewDestinationPublicApi = {
    getGoogleReviewDestination: async () => destination,
  }
  const deps = {
    portalRepo: createPortalRepository(db),
    commandStore: options.wrapStore?.(baseStore) ?? baseStore,
    publicationRepo: publicationRepo(),
    portalTokenRepo: createPortalTokenRepository(db),
    propertyGoogleReviewDestinationApi: destinationApi,
    propertyLifecycleApi: {
      isPropertyActive: async () => options.propertyActive ?? true,
    },
    staffPublicApi: staffApi(options.accessible ?? null),
    idGen: randomUUID,
    clock: () => NOW,
  }
  return {
    publish: publishPortalChanges(deps),
    publishMany: publishPortalsChanges(deps),
    preview: previewPortalChanges(deps),
    rollback: rollbackPortalPublication({
      portalRepo: deps.portalRepo,
      publicationRepo: deps.publicationRepo,
      commandStore: deps.commandStore,
      staffPublicApi: deps.staffPublicApi,
      idGen: randomUUID,
      clock: () => NOW,
    }),
    issue: issuePortalToken({
      portalRepo: deps.portalRepo,
      portalTokenRepo: deps.portalTokenRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: deps.commandStore,
      tokenCodec: testPortalTokenCodec(
        () =>
          `pt_${randomBytes(12).toString('base64url')}_${randomBytes(32).toString('base64url')}`,
      ),
      addressCipher: null,
      reportPrintCodeProblem: () => undefined,
      idGen: randomUUID,
      clock: () => NOW,
      address: {
        appOrigin: 'https://app.example.test',
        printOrigin: 'https://ap.example.test',
      },
    }),
  }
}

const ctxOf = (
  org: OrganizationId,
  role: AuthContext['role'] = 'PropertyManager',
): AuthContext => buildTestAuthContext({ organizationId: org, userId: MANAGER, role })

type Live = Readonly<{
  org: OrganizationId
  property: PropertyId
  portal: PortalId
  seed: PortalWorkingCopySeed
}>

type DraftOptions = Readonly<{
  wordmark?: string
  personalName?: string
  /** Stays a draft; `true` publishes nothing and records no live version. */
  published?: boolean
}>

/** A Portal of a new Property with a Brand Profile and English wording, not live yet. */
async function seedDraft(org: OrganizationId, options: DraftOptions = {}): Promise<Live> {
  const property = propertyId(randomUUID())
  const portal = portalId(randomUUID())
  const seed: PortalWorkingCopySeed = {
    organizationId: org,
    propertyId: property,
    portalId: portal,
    slug: `lifecycle-${portal.slice(0, 8)}`,
    primaryGuestLocale: 'en',
    additionalGuestLocales: [],
    brand: {
      displayName: 'Hotel Test',
      defaultHeroImageUrl: null,
      ...(options.wordmark ? { wordmark: options.wordmark } : {}),
    },
    contents: [{ locale: 'en', title: 'Hotel Test', shortDescription: 'Welcome' }],
    overrides: [],
    categoryId: randomUUID(),
    links: [],
  }
  await seedPortalWorkingCopy(getPool(), seed)
  if (options.personalName) {
    await getPool().query(
      `UPDATE portals SET kind = 'personal', public_name = 'Harbor', name = $3
        WHERE organization_id = $1 AND id = $2`,
      [org, portal, options.personalName],
    )
  }
  return { org, property, portal, seed }
}

const scopeOf = (live: Live) => ({
  organizationId: live.org,
  propertyId: live.property,
  portalId: live.portal,
})

async function sourceOf(live: Live) {
  const source = await publicationRepo().loadWorkingCopy(live.org, live.portal)
  if (!source) throw new Error('the Portal has no working copy')
  return source
}

/** The first version, published from the draft as it is, the way a first publication writes it. */
async function goLive(live: Live): Promise<Live> {
  await publishFromSource(scopeOf(live), await sourceOf(live), ratingGoalGuard)
  return live
}

/** A second version of the draft as it is now, live in place of the first. */
async function republish(live: Live): Promise<void> {
  await republishFromSource(scopeOf(live), await sourceOf(live), ratingGoalGuard)
}

async function seedLive(org: OrganizationId, options: DraftOptions = {}): Promise<Live> {
  return goLive(await seedDraft(org, options))
}

type Address = 'current' | 'older' | 'none'

/** The Portal's printed address, issued through the real use case. */
async function giveAddress(live: Live, address: Address = 'current'): Promise<void> {
  if (address === 'none') return
  await wire().issue({ portalId: live.portal }, ctxOf(live.org))
  if (address === 'older') {
    await getPool().query(
      `DELETE FROM portal_access_artifacts WHERE organization_id = $1 AND portal_id = $2`,
      [live.org, live.portal],
    )
  }
}

/** A live Portal that may publish: it has its address, and the outbox starts empty. */
async function seedReady(
  org: OrganizationId,
  options: DraftOptions & Readonly<{ address?: Address }> = {},
): Promise<Live> {
  const live = await seedLive(org, options)
  await giveAddress(live, options.address)
  await clearFacts()
  return live
}

const clearFacts = () =>
  getPool().query(`DELETE FROM outbox_events WHERE organization_id = ANY($1)`, [
    [ORG_A, ORG_B],
  ])

/** The Property rewords its welcome title: the draft moves, the Portal row does not. */
const rewordWelcome = (live: Live, title: string) =>
  getPool().query(
    `UPDATE property_portal_brand_contents SET title = $2
      WHERE organization_id = $1 AND property_id = $3 AND locale = 'en'`,
    [live.org, title, live.property],
  )

/** Recorded changes still waiting to go live, without moving the draft. */
async function openChanges(live: Live, count: number): Promise<void> {
  await getDb().transaction(async (tx) => {
    for (let index = 0; index < count; index += 1) {
      await recordPortalPendingContentChange(tx, {
        organizationId: live.org,
        propertyId: live.property,
        portalId: live.portal,
        kind: 'portal_links',
        key: `link:${index}`,
        sourceVersion: EDITED_AT.toISOString(),
        changedAt: EDITED_AT,
      })
    }
  })
}

const setState = (live: Live, state: string) =>
  getPool().query(
    `UPDATE portals SET publication_state = $3 WHERE organization_id = $1 AND id = $2`,
    [live.org, live.portal, state],
  )

const snapshotsOf = async (live: Live) =>
  (
    await getPool().query(
      `SELECT id, version, created_by, created_at, destination_uri, destination_source_epoch,
              configuration_digest
       FROM portal_publication_snapshots
       WHERE organization_id = $1 AND portal_id = $2 ORDER BY version`,
      [live.org, live.portal],
    )
  ).rows

const activationsOf = async (live: Live) =>
  (
    await getPool().query(
      `SELECT snapshot_id, activation_sequence, kind, activated_by, activated_at,
              deactivated_at, deactivation_reason
       FROM portal_publication_activations
       WHERE organization_id = $1 AND portal_id = $2 ORDER BY activation_sequence`,
      [live.org, live.portal],
    )
  ).rows

const portalRow = async (live: Live) =>
  (
    await getPool().query(
      `SELECT name, slug, theme, publication_state, updated_at FROM portals
       WHERE organization_id = $1 AND id = $2`,
      [live.org, live.portal],
    )
  ).rows[0]

const factsOf = async (org: OrganizationId, tag?: string) =>
  (
    await getPool().query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload FROM outbox_events
       WHERE organization_id = $1 AND ($2::text IS NULL OR event_type = $2)
       ORDER BY created_at, event_type`,
      [org, tag ?? null],
    )
  ).rows

const publicationFacts = async (org: OrganizationId) =>
  (await factsOf(org)).filter((row) => row.event_type.startsWith('portal.publication.'))

async function expectNothingWritten(live: Live, versions = 1): Promise<void> {
  expect(await snapshotsOf(live)).toHaveLength(versions)
  expect(await activationsOf(live)).toHaveLength(versions)
  expect(await factsOf(live.org)).toEqual([])
}

describe.sequential('publishPortalChanges (real PostgreSQL, two tenants)', () => {
  it('replaces the live version with a new immutable one when the draft has moved', async () => {
    const live = await seedReady(ORG_A)
    const before = await portalRow(live)
    await rewordWelcome(live, 'Hotel Test, renewed')

    const result = await wire().publish({ portalId: live.portal }, ctxOf(ORG_A))

    expect(result).toMatchObject({ outcome: 'published', version: 2, activatedAt: NOW })
    const [first, second] = await snapshotsOf(live)
    expect(second).toMatchObject({
      version: 2,
      created_by: MANAGER,
      created_at: NOW,
      destination_uri: LIVE_DESTINATION.uri,
    })
    expect(second.configuration_digest).not.toBe(first.configuration_digest)
    expect(await activationsOf(live)).toEqual([
      expect.objectContaining({
        activation_sequence: 1,
        deactivated_at: NOW,
        deactivation_reason: 'replaced',
      }),
      expect.objectContaining({
        snapshot_id: second.id,
        activation_sequence: 2,
        kind: 'publish',
        activated_by: MANAGER,
        activated_at: NOW,
        deactivated_at: null,
        deactivation_reason: null,
      }),
    ])
    const after = await portalRow(live)
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime())
    expect(after.publication_state).toBe('published')
    const updated = await factsOf(ORG_A, 'portal.updated')
    expect(updated).toHaveLength(1)
    expect(updated[0]?.payload).toMatchObject({
      previousPublicationState: 'published',
      publicationState: 'published',
    })
  })

  describe('a personal Portal whose staff name is in a wordmark', () => {
    const NAME = 'Marco Rossi'

    it('publishes and republishes when the name is only in the Property brand', async () => {
      const live = await seedReady(ORG_A, { personalName: NAME })
      await getPool().query(
        `UPDATE property_portal_brand_profiles SET wordmark = 'Pizzeria Marco'
          WHERE organization_id = $1 AND property_id = $2`,
        [ORG_A, live.property],
      )

      await expect(
        wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).resolves.toMatchObject({ outcome: 'published', version: 2 })
      await expect(
        wire({ destination: RELINKED_DESTINATION }).publish(
          { portalId: live.portal },
          ctxOf(ORG_A),
        ),
      ).resolves.toMatchObject({ outcome: 'published', version: 3 })
    })

    it('refuses the name in a wordmark the Portal wrote itself and writes nothing', async () => {
      const live = await seedReady(ORG_A, { personalName: NAME })
      await seedPortalLookOverride(getPool(), live.seed, {
        identity: { wordmark: 'MARCO', logoAssetId: null },
        lookVersion: 2,
      })

      await expect(
        wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).rejects.toMatchObject({ code: 'personal_portal_name_private' })
      await expectNothingWritten(live)
    })

    it('still refuses the name in the Portal wording', async () => {
      const live = await seedReady(ORG_A, { personalName: NAME })
      await getPool().query(
        `INSERT INTO portal_localized_overrides
           (id, organization_id, property_id, portal_id, locale, title,
            short_description, hero_image_url, linktree_title, version, updated_by,
            created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'en', 'Ask Marco', 'Rate your visit.',
                 NULL, NULL, 1, 'seed-manager', $4, $4)`,
        [ORG_A, live.property, live.portal, EDITED_AT],
      )

      await expect(
        wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).rejects.toMatchObject({ code: 'personal_portal_name_private' })
      await expectNothingWritten(live)
    })
  })

  it('records one publication fact that quotes the new snapshot and nothing of its content', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 2)

    await wire().publish({ portalId: live.portal }, ctxOf(ORG_A))

    const [, second] = await snapshotsOf(live)
    const facts = await factsOf(ORG_A)
    expect(facts.map((row) => row.event_type).sort()).toEqual([
      'portal.publication.published',
      'portal.updated',
    ])
    expect(
      facts.find((row) => row.event_type === 'portal.publication.published')?.payload,
    ).toMatchObject({
      publicationSnapshotId: second.id,
      publicationVersion: 2,
      publicationDigest: second.configuration_digest,
      userId: MANAGER,
    })
    expect(JSON.stringify(facts)).not.toContain(LIVE_DESTINATION.uri)
  })

  it('resolves the recorded changes against the new snapshot', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 2)

    await wire().publish({ portalId: live.portal }, ctxOf(ORG_A))

    const [, second] = await snapshotsOf(live)
    const pending = await getPool().query(
      `SELECT resolved_snapshot_id FROM portal_pending_content_changes
       WHERE organization_id = $1 AND portal_id = $2`,
      [ORG_A, live.portal],
    )
    expect(pending.rows).toEqual([
      { resolved_snapshot_id: second.id },
      { resolved_snapshot_id: second.id },
    ])
  })

  it('publishes when the reviewed digest is the one the draft produces now', async () => {
    const live = await seedReady(ORG_A)
    await rewordWelcome(live, 'Hotel Test, renewed')
    const reviewedDigest = buildPortalPublicationSnapshot({
      id: randomUUID(),
      portalId: live.portal,
      organizationId: live.org,
      propertyId: live.property,
      version: 2,
      source: await sourceOf(live),
      destination: LIVE_DESTINATION,
      createdBy: MANAGER,
      createdAt: NOW,
    }).configurationDigest

    const result = await wire().publish(
      { portalId: live.portal, reviewedDigest },
      ctxOf(ORG_A),
    )

    expect(result).toMatchObject({
      outcome: 'published',
      configurationDigest: reviewedDigest,
    })
    expect(await snapshotsOf(live)).toHaveLength(2)
  })

  it('refuses and writes nothing when the draft no longer says what was reviewed', async () => {
    const live = await seedReady(ORG_A)
    await rewordWelcome(live, 'Hotel Test, renewed')

    await expect(
      wire().publish(
        { portalId: live.portal, reviewedDigest: 'digest-of-an-earlier-draft' },
        ctxOf(ORG_A),
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict' })
    await expectNothingWritten(live)
  })

  it('does nothing when nothing is pending', async () => {
    const live = await seedReady(ORG_A)

    await expect(
      wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
    ).resolves.toEqual({
      outcome: 'unchanged',
      version: 1,
    })
    await expectNothingWritten(live)
  })

  it('republishes a draft that matches the live content when the Property destination was relinked', async () => {
    const live = await seedReady(ORG_A)

    const result = await wire({ destination: RELINKED_DESTINATION }).publish(
      { portalId: live.portal },
      ctxOf(ORG_A),
    )

    expect(result).toMatchObject({ outcome: 'published', version: 2 })
    expect((await snapshotsOf(live))[1]).toMatchObject({
      destination_uri: RELINKED_DESTINATION.uri,
      destination_source_epoch: RELINKED_DESTINATION.sourceEpoch,
    })
  })

  it('still runs the readiness gates for a relink-only republish', async () => {
    const live = await seedReady(ORG_A, { address: 'none' })

    await expect(
      wire({ destination: RELINKED_DESTINATION }).publish(
        { portalId: live.portal },
        ctxOf(ORG_A),
      ),
    ).rejects.toMatchObject({ code: 'token_unavailable' })
    await expectNothingWritten(live)
  })

  it('publishes when only a recorded change is pending', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)

    await expect(
      wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
    ).resolves.toMatchObject({ outcome: 'published', version: 2 })
  })

  it('treats a live version of the earlier design as a pending change', async () => {
    const live = await seedDraft(ORG_A)
    await setState(live, 'published')
    await seedLegacySnapshot({
      ...scopeOf(live),
      idTail: 7_310_000 + Math.floor(Math.random() * 1_000_000),
      version: 1,
      schemaVersion: 2,
      at: new Date('2026-08-26T11:00:00.000Z'),
      activation: 'open',
    })
    await giveAddress(live)

    await expect(
      wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
    ).resolves.toMatchObject({ outcome: 'published', version: 2 })
  })

  it.each(['draft', 'disabled', 'archived'] as const)(
    'refuses a %s Portal, which publishing (not republishing) takes live',
    async (state) => {
      const live = await seedReady(ORG_A)
      await openChanges(live, 1)
      await setState(live, state)

      await expect(
        wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).rejects.toMatchObject({ code: 'invalid_publication_transition' })
      await expectNothingWritten(live)
    },
  )

  it('refuses a published Portal that has no live version to replace', async () => {
    const live = await seedDraft(ORG_A)
    await setState(live, 'published')
    await openChanges(live, 1)

    await expect(
      wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
    expect(await snapshotsOf(live)).toEqual([])
    expect(await factsOf(ORG_A)).toEqual([])
  })

  it('refuses a role that cannot edit Portals', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)

    await expect(
      wire().publish({ portalId: live.portal }, ctxOf(ORG_A, 'Member')),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expectNothingWritten(live)
  })

  it('refuses an unknown Portal and a Portal of another organization', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)
    const { publish } = wire()

    await expect(publish({ portalId: randomUUID() }, ctxOf(ORG_A))).rejects.toMatchObject(
      { code: 'portal_not_found' },
    )
    await expect(publish({ portalId: live.portal }, ctxOf(ORG_B))).rejects.toMatchObject({
      code: 'portal_not_found',
    })
    await expectNothingWritten(live)
  })

  describe('readiness gates, the same as for a first publication', () => {
    it('needs an active Property', async () => {
      const live = await seedReady(ORG_A)
      await openChanges(live, 1)

      await expect(
        wire({ propertyActive: false }).publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).rejects.toMatchObject({ code: 'portal_inactive' })
      await expectNothingWritten(live)
    })

    it('needs a verified Google review destination', async () => {
      const live = await seedReady(ORG_A)
      await openChanges(live, 1)

      await expect(
        wire({ destination: UNAVAILABLE_DESTINATION }).publish(
          { portalId: live.portal },
          ctxOf(ORG_A),
        ),
      ).rejects.toMatchObject({ code: 'google_review_destination_unavailable' })
      await expectNothingWritten(live)
    })

    it('needs a responsible manager', async () => {
      const live = await seedReady(ORG_A)
      await openChanges(live, 1)
      await getPool().query(
        `UPDATE portals SET responsibility_needed_since = $3
          WHERE organization_id = $1 AND id = $2`,
        [ORG_A, live.portal, NOW],
      )

      await expect(
        wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).rejects.toMatchObject({ code: 'responsible_manager_ineligible' })
      await expectNothingWritten(live)
    })

    it('needs a public address', async () => {
      const live = await seedReady(ORG_A, { address: 'none' })
      await openChanges(live, 1)

      await expect(
        wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).rejects.toMatchObject({ code: 'token_unavailable' })
      await expectNothingWritten(live)
    })

    it('publishes over an older code, which guests still open', async () => {
      const live = await seedReady(ORG_A, { address: 'older' })
      await openChanges(live, 1)

      await expect(
        wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).resolves.toMatchObject({ outcome: 'published' })
    })

    it('stops at a blocker in the primary language, as a first publication does', async () => {
      const live = await seedReady(ORG_A)
      await getPool().query(
        `DELETE FROM property_portal_brand_contents
          WHERE organization_id = $1 AND property_id = $2`,
        [ORG_A, live.property],
      )

      await expect(
        wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
      await expectNothingWritten(live)
    })

    it('asks nothing of a Portal with nothing to publish', async () => {
      const live = await seedReady(ORG_A)

      await expect(
        wire({
          propertyActive: false,
          destination: UNAVAILABLE_DESTINATION,
        }).publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).resolves.toMatchObject({ outcome: 'unchanged' })
    })
  })

  it('never rewrites the Portal row itself beyond its revision, and keeps it published', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)
    const before = await portalRow(live)

    await wire().publish({ portalId: live.portal }, ctxOf(ORG_A))

    const after = await portalRow(live)
    expect({ ...after, updated_at: null }).toEqual({ ...before, updated_at: null })
    expect(after.publication_state).toBe('published')
  })
})

describe.sequential('publishPortalsChanges (real PostgreSQL, two tenants)', () => {
  /** Two live Portals of one Property, each with a recorded change pending. */
  async function seedTwo(address: readonly [Address, Address] = ['current', 'current']) {
    const first = await seedLive(ORG_A)
    const secondId = portalId(randomUUID())
    await seedSiblingPortal(getPool(), first.seed, {
      portalId: secondId,
      slug: `second-${secondId.slice(0, 8)}`,
    })
    const second: Live = { ...first, portal: secondId }
    await goLive(second)
    await giveAddress(first, address[0])
    await giveAddress(second, address[1])
    await openChanges(first, 1)
    await openChanges(second, 1)
    await clearFacts()
    return { first, second }
  }

  const publishedOrder = async (org: OrganizationId) =>
    (await factsOf(org, 'portal.publication.published')).map(
      (row) => row.payload.portalId,
    )

  it('publishes each Portal in order and reports the outcome per Portal', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)
    const missing = randomUUID()

    const results = await wire().publishMany(
      { portals: [{ portalId: live.portal }, { portalId: missing }] },
      ctxOf(ORG_A),
    )

    expect(results).toEqual([
      expect.objectContaining({ portalId: live.portal, outcome: 'published' }),
      expect.objectContaining({
        portalId: missing,
        outcome: 'failed',
        code: 'portal_not_found',
      }),
    ])
  })

  it('goes on after a Portal that cannot be published', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)

    const results = await wire().publishMany(
      { portals: [{ portalId: randomUUID() }, { portalId: live.portal }] },
      ctxOf(ORG_A),
    )

    expect(results.map((result) => result.outcome)).toEqual(['failed', 'published'])
    expect(await snapshotsOf(live)).toHaveLength(2)
  })

  it('publishes two live Portals in the order given', async () => {
    const { first, second } = await seedTwo()

    const results = await wire().publishMany(
      { portals: [{ portalId: second.portal }, { portalId: first.portal }] },
      ctxOf(ORG_A),
    )

    expect(results.map((r) => [r.portalId, r.outcome])).toEqual([
      [second.portal, 'published'],
      [first.portal, 'published'],
    ])
    expect(await publishedOrder(ORG_A)).toEqual([second.portal, first.portal])
  })

  it('goes on to the next Portal after a store conflict on the first', async () => {
    const { first, second } = await seedTwo()
    // The Portal row moves between the read and the write of the first publication.
    const conflicting = wire({
      wrapStore: (store) => ({
        ...store,
        republishPortal: async (command) => {
          if (command.portalId === first.portal) {
            await getPool().query(
              `UPDATE portals SET updated_at = updated_at + interval '1 second'
                WHERE organization_id = $1 AND id = $2`,
              [ORG_A, first.portal],
            )
          }
          return store.republishPortal(command)
        },
      }),
    })

    const results = await conflicting.publishMany(
      { portals: [{ portalId: first.portal }, { portalId: second.portal }] },
      ctxOf(ORG_A),
    )

    expect(results).toEqual([
      expect.objectContaining({
        portalId: first.portal,
        outcome: 'failed',
        code: 'revision_conflict',
      }),
      expect.objectContaining({ portalId: second.portal, outcome: 'published' }),
    ])
    expect(await publishedOrder(ORG_A)).toEqual([second.portal])
    expect(await snapshotsOf(first)).toHaveLength(1)
  })

  it('goes on to the next Portal after a readiness gate refuses the first', async () => {
    const { first, second } = await seedTwo(['none', 'current'])

    const results = await wire().publishMany(
      { portals: [{ portalId: first.portal }, { portalId: second.portal }] },
      ctxOf(ORG_A),
    )

    expect(results).toEqual([
      expect.objectContaining({
        portalId: first.portal,
        outcome: 'failed',
        code: 'token_unavailable',
      }),
      expect.objectContaining({ portalId: second.portal, outcome: 'published' }),
    ])
    expect(await publishedOrder(ORG_A)).toEqual([second.portal])
  })

  it('refuses a ticked Portal that changed after it was reviewed and publishes the others', async () => {
    const { first, second } = await seedTwo()

    const results = await wire().publishMany(
      {
        portals: [
          { portalId: first.portal, reviewedDigest: 'digest-of-an-earlier-draft' },
          { portalId: second.portal },
        ],
      },
      ctxOf(ORG_A),
    )

    expect(results).toEqual([
      {
        portalId: first.portal,
        outcome: 'failed',
        code: 'revision_conflict',
        message:
          'The Portal changed after you reviewed it. Review the changes again before publishing',
      },
      expect.objectContaining({ portalId: second.portal, outcome: 'published' }),
    ])
    expect(await publishedOrder(ORG_A)).toEqual([second.portal])
  })

  it('publishes a ticked Portal whose reviewed digest still matches', async () => {
    const { first } = await seedTwo()
    const reviewedDigest = buildPortalPublicationSnapshot({
      id: randomUUID(),
      portalId: first.portal,
      organizationId: first.org,
      propertyId: first.property,
      version: 2,
      source: await sourceOf(first),
      destination: LIVE_DESTINATION,
      createdBy: MANAGER,
      createdAt: NOW,
    }).configurationDigest

    const results = await wire().publishMany(
      { portals: [{ portalId: first.portal, reviewedDigest }] },
      ctxOf(ORG_A),
    )

    expect(results).toEqual([
      expect.objectContaining({ portalId: first.portal, outcome: 'published' }),
    ])
  })

  it('reports a Portal with nothing pending as unchanged', async () => {
    const live = await seedReady(ORG_A)

    await expect(
      wire().publishMany({ portals: [{ portalId: live.portal }] }, ctxOf(ORG_A)),
    ).resolves.toEqual([{ portalId: live.portal, outcome: 'unchanged', version: 1 }])
  })

  it('names each Portal once, in the order given', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)

    const results = await wire().publishMany(
      { portals: [{ portalId: live.portal }, { portalId: live.portal }] },
      ctxOf(ORG_A),
    )

    expect(results).toHaveLength(1)
    expect(await snapshotsOf(live)).toHaveLength(2)
  })

  it('does not hide a fault that is not a Portal error', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)
    const faulty = wire({
      wrapStore: (store) => ({
        ...store,
        republishPortal: async () => {
          throw new Error('connection reset')
        },
      }),
    })

    await expect(
      faulty.publishMany({ portals: [{ portalId: live.portal }] }, ctxOf(ORG_A)),
    ).rejects.toThrow('connection reset')
  })

  it('reports a Portal of another organization as not found and leaves it alone', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)

    const results = await wire().publishMany(
      { portals: [{ portalId: live.portal }] },
      ctxOf(ORG_B),
    )

    expect(results).toEqual([
      expect.objectContaining({
        portalId: live.portal,
        outcome: 'failed',
        code: 'portal_not_found',
      }),
    ])
    await expectNothingWritten(live)
  })
})

describe.sequential('previewPortalChanges (real PostgreSQL, two tenants)', () => {
  it('says what a publication would write and writes nothing', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)

    const result = await wire().preview({ portalId: live.portal }, ctxOf(ORG_A))

    expect(result).toEqual({ outcome: 'would_publish', version: 2, pendingEdits: 1 })
    await expectNothingWritten(live)
  })

  it('reads nothing pending as unchanged', async () => {
    const live = await seedReady(ORG_A)

    await expect(
      wire().preview({ portalId: live.portal }, ctxOf(ORG_A)),
    ).resolves.toEqual({ outcome: 'unchanged', version: 1, pendingEdits: 0 })
  })

  it("counts the manager's open unpublished edits, so a caller can tell a draft from a bare upgrade", async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 3)

    await expect(
      wire().preview({ portalId: live.portal }, ctxOf(ORG_A)),
    ).resolves.toMatchObject({ outcome: 'would_publish', pendingEdits: 3 })
  })

  it.each([
    ['hasAddress', { address: 'none' as const }, {}, 'token_unavailable'],
    ['propertyActive', {}, { propertyActive: false }, 'portal_inactive'],
    [
      'destination',
      {},
      { destination: UNAVAILABLE_DESTINATION },
      'google_review_destination_unavailable',
    ],
    ['responsibility', {}, { responsible: false }, 'responsible_manager_ineligible'],
  ])(
    'refuses what the real publication refuses (%s), so a dry run predicts the apply',
    async (_name, seedOptions, wireOptions, code) => {
      const live = await seedReady(ORG_A, seedOptions)
      await openChanges(live, 1)
      if ('responsible' in wireOptions) {
        await getPool().query(
          `UPDATE portals SET responsibility_needed_since = $3
            WHERE organization_id = $1 AND id = $2`,
          [ORG_A, live.portal, NOW],
        )
      }
      const { responsible: _responsible, ...stackOptions } = {
        responsible: undefined,
        ...wireOptions,
      }
      const stack = wire(stackOptions)

      await expect(
        stack.preview({ portalId: live.portal }, ctxOf(ORG_A)),
      ).rejects.toMatchObject({ code })
      await expect(
        stack.publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).rejects.toMatchObject({ code })
    },
  )

  it('refuses a Portal that is not live, a role that cannot edit Portals and another organization', async () => {
    const draft = await seedReady(ORG_A)
    await openChanges(draft, 1)
    await setState(draft, 'draft')
    await expect(
      wire().preview({ portalId: draft.portal }, ctxOf(ORG_A)),
    ).rejects.toMatchObject({ code: 'invalid_publication_transition' })

    const live = await seedReady(ORG_A)
    await openChanges(live, 1)
    await expect(
      wire().preview({ portalId: live.portal }, ctxOf(ORG_A, 'Member')),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      wire().preview({ portalId: live.portal }, ctxOf(ORG_B)),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })
})

describe.sequential('rollbackPortalPublication (real PostgreSQL, two tenants)', () => {
  const admin = (org: OrganizationId = ORG_A) => ctxOf(org, 'AccountAdmin')

  /** Two live versions: the first as published, the second after the welcome was reworded. */
  async function seedTwoVersions(options: DraftOptions = {}): Promise<Live> {
    const live = await seedLive(ORG_A, options)
    await rewordWelcome(live, 'Hotel Test, renewed')
    await republish(live)
    await clearFacts()
    return live
  }

  it.each([1, 2] as const)(
    'refuses retired format %i without writing an activation',
    async (schemaVersion) => {
      const live = await seedDraft(ORG_A)
      await setState(live, 'published')
      const idTail = 7_320_000 + Math.floor(Math.random() * 1_000_000)
      const at = new Date('2026-08-26T11:00:00.000Z')
      await seedLegacySnapshot({
        ...scopeOf(live),
        idTail,
        version: 1,
        schemaVersion,
        at,
        activation: 'replaced',
      })
      await seedLegacySnapshot({
        ...scopeOf(live),
        idTail,
        version: 2,
        schemaVersion,
        at: new Date(at.getTime() + 60_000),
        activation: 'open',
      })

      await expect(
        wire().rollback({ portalId: live.portal, version: 1 }, admin()),
      ).rejects.toMatchObject({ code: 'not_restorable' })
      await expectNothingWritten(live, 2)
    },
  )

  describe('a personal Portal whose staff name is in a wordmark', () => {
    it('rolls back when the name is only in the Property brand', async () => {
      const live = await seedLive(ORG_A, {
        personalName: 'Marco Rossi',
        wordmark: 'Pizzeria Marco',
      })
      await rewordWelcome(live, 'Hotel Test, renewed')
      await republish(live)

      await expect(
        wire().rollback({ portalId: live.portal, version: 1 }, admin()),
      ).resolves.toMatchObject({ version: 1 })
      expect(await activationsOf(live)).toHaveLength(3)
    })

    it('refuses the name in a wordmark the Portal wrote itself', async () => {
      const live = await seedDraft(ORG_A, { personalName: 'Marco Rossi' })
      await seedPortalLookOverride(getPool(), live.seed, {
        identity: { wordmark: 'MARCO', logoAssetId: null },
        lookVersion: 2,
      })
      await goLive(live)
      await rewordWelcome(live, 'Hotel Test, renewed')
      await republish(live)
      await clearFacts()

      await expect(
        wire().rollback({ portalId: live.portal, version: 1 }, admin()),
      ).rejects.toMatchObject({ code: 'personal_portal_name_private' })
      await expectNothingWritten(live, 2)
    })
  })

  it('appends an activation for an older immutable version', async () => {
    const live = await seedTwoVersions()
    const [first] = await snapshotsOf(live)
    const before = await portalRow(live)

    await expect(
      wire().rollback({ portalId: live.portal, version: 1 }, admin()),
    ).resolves.toEqual({
      snapshotId: first.id,
      version: 1,
      configurationDigest: first.configuration_digest,
      activatedAt: NOW,
    })

    expect(await snapshotsOf(live)).toHaveLength(2)
    const activations = await activationsOf(live)
    expect(activations).toHaveLength(3)
    expect(activations[1]).toMatchObject({ activation_sequence: 2, deactivated_at: NOW })
    expect(activations[2]).toEqual({
      snapshot_id: first.id,
      activation_sequence: 3,
      kind: 'rollback',
      activated_by: MANAGER,
      activated_at: NOW,
      deactivated_at: null,
      deactivation_reason: null,
    })
    expect(await publicationFacts(ORG_A)).toEqual([
      expect.objectContaining({
        event_type: 'portal.publication.rolled_back',
        payload: expect.objectContaining({
          organizationId: ORG_A,
          propertyId: live.property,
          portalId: live.portal,
          publicationSnapshotId: first.id,
          publicationVersion: 1,
          publicationDigest: first.configuration_digest,
          userId: MANAGER,
          occurredAt: NOW.toISOString(),
        }),
      }),
    ])
    const after = await portalRow(live)
    expect(after.publication_state).toBe('published')
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime())
  })

  it('makes a later version live again after an earlier one was restored', async () => {
    const live = await seedTwoVersions()
    const { rollback } = wire()
    await rollback({ portalId: live.portal, version: 1 }, admin())
    const [, second] = await snapshotsOf(live)

    await expect(
      rollback({ portalId: live.portal, version: 2 }, admin()),
    ).resolves.toMatchObject({ snapshotId: second.id, version: 2 })

    const activations = await activationsOf(live)
    expect(activations.at(-1)).toMatchObject({
      snapshot_id: second.id,
      kind: 'rollback',
      activation_sequence: 4,
      deactivated_at: null,
    })
  })

  it('refuses to make the version that is already live live again', async () => {
    const live = await seedTwoVersions()

    await expect(
      wire().rollback({ portalId: live.portal, version: 2 }, admin()),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
    await expectNothingWritten(live, 2)
  })

  it('rejects a version that does not exist for this Portal', async () => {
    const live = await seedTwoVersions()

    await expect(
      wire().rollback({ portalId: live.portal, version: 99 }, admin()),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
    await expectNothingWritten(live, 2)
  })

  it('never reaches a Portal of another organization or one the role cannot edit', async () => {
    const live = await seedTwoVersions()
    const { rollback } = wire()

    await expect(
      rollback({ portalId: live.portal, version: 1 }, admin(ORG_B)),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
    await expect(
      rollback({ portalId: live.portal, version: 1 }, ctxOf(ORG_A, 'Member')),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expectNothingWritten(live, 2)
  })

  it('never republishes a disabled Portal as a rollback side effect', async () => {
    const live = await seedTwoVersions()
    await setState(live, 'disabled')

    await expect(
      wire().rollback({ portalId: live.portal, version: 1 }, admin()),
    ).rejects.toMatchObject({ code: 'invalid_publication_transition' })
    await expectNothingWritten(live, 2)
    expect((await portalRow(live)).publication_state).toBe('disabled')
  })
})

describe.sequential('completeContentReview (real PostgreSQL, two tenants)', () => {
  const VERIFIED = { ...LIVE_DESTINATION, retrievedAt: NOW } as const

  function review(
    destination: Destination | Error = VERIFIED,
    accessible?: PropertyId[],
  ) {
    const db = getDb()
    const groupRepo = createPortalGroupRepository(db)
    return completeContentReview({
      portalRepo: createPortalRepository(db),
      staffPublicApi: staffApi(accessible ?? null),
      portalGroupLookup: { findGroupForPortal: groupRepo.findGroupForPortal },
      propertyGoogleReviewDestinationApi: {
        getGoogleReviewDestination: async () => {
          if (destination instanceof Error) throw destination
          return destination
        },
      },
      factStore: createPortalWorkflowFactStore(db),
      clock: () => NOW,
    })
  }

  async function seedGrouped(live: Live) {
    const group = randomUUID()
    await getPool().query(
      `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, 'Front desk', $4, $4)`,
      [group, live.org, live.property, EDITED_AT],
    )
    await getPool().query(
      `INSERT INTO portal_group_memberships
         (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [live.org, live.property, live.portal, group, EDITED_AT, MANAGER],
    )
    return group
  }

  it('records an exact occurrence-time Portal workflow command', async () => {
    const live = await seedLive(ORG_A)
    const group = await seedGrouped(live)
    await clearFacts()

    const result = await review()(
      { portalId: live.portal, reviewId: 'review-1', revision: 1 },
      ctxOf(ORG_A),
    )

    expect(result.status).toBe('recorded')
    const facts = await factsOf(ORG_A)
    expect(facts.map((row) => row.event_type).sort()).toEqual([
      'portal.approved_destination_ratio.recorded',
      'portal.configuration_completeness.recorded',
      'portal.content_review.completed',
    ])
    for (const fact of facts) {
      expect(fact.payload).toMatchObject({
        organizationId: ORG_A,
        propertyId: live.property,
        portalId: live.portal,
        portalGroupId: group,
        reviewId: 'review-1',
        revision: 1,
        occurredAt: NOW.toISOString(),
      })
    }
    expect(
      facts.find((row) => row.event_type.includes('completeness'))?.payload,
    ).toMatchObject({ fieldSet: 'immersive_hub', requiredFields: 5 })
  })

  it.each([
    ['the Property has no Google review destination', null],
    [
      'the destination is waiting for a refresh',
      { ...VERIFIED, state: 'awaiting_refresh' },
    ],
  ] as const)(
    'records the Google destination as not verified when %s',
    async (_case, destination) => {
      const verified = await seedLive(ORG_A)
      const unverified = await seedLive(ORG_A)
      await clearFacts()
      const input = (portal: PortalId) => ({
        portalId: portal,
        reviewId: 'review-1',
        revision: 1,
      })

      await review()(input(verified.portal), ctxOf(ORG_A))
      await review(destination as Destination)(input(unverified.portal), ctxOf(ORG_A))

      const [withDestination, without] = [verified, unverified].map(async (live) => {
        const rows = await factsOf(ORG_A, 'portal.configuration_completeness.recorded')
        return rows.find((row) => row.payload.portalId === live.portal)?.payload
      })
      const completed = async (counted: typeof withDestination) =>
        Number((await counted)?.completedFields)
      expect(await completed(without)).toBe((await completed(withDestination)) - 1)
    },
  )

  it('records nothing when the Google destination cannot be read', async () => {
    const live = await seedLive(ORG_A)
    await clearFacts()
    const lookupFailure = new Error('property destination lookup unavailable')

    await expect(
      review(lookupFailure)(
        { portalId: live.portal, reviewId: 'review-1', revision: 1 },
        ctxOf(ORG_A),
      ),
    ).rejects.toBe(lookupFailure)

    expect(await factsOf(ORG_A)).toEqual([])
  })

  it('passes complete correction lineage without creating an unrelated review', async () => {
    const live = await seedLive(ORG_A)
    await clearFacts()
    const lineage = {
      contentReviewSourceEventId: randomUUID(),
      configurationSourceEventId: randomUUID(),
      destinationRatioSourceEventId: randomUUID(),
    }

    await review()(
      {
        portalId: live.portal,
        reviewId: 'review-1',
        revision: 2,
        supersedes: lineage,
      },
      ctxOf(ORG_A),
    )

    const facts = await factsOf(ORG_A)
    expect(facts).toHaveLength(3)
    const supersedes = (tag: string) =>
      facts.find((row) => row.event_type === tag)?.payload.supersedesSourceEventId
    expect(supersedes('portal.content_review.completed')).toBe(
      lineage.contentReviewSourceEventId,
    )
    expect(supersedes('portal.configuration_completeness.recorded')).toBe(
      lineage.configurationSourceEventId,
    )
    expect(supersedes('portal.approved_destination_ratio.recorded')).toBe(
      lineage.destinationRatioSourceEventId,
    )
    for (const fact of facts) {
      expect(fact.payload).toMatchObject({ reviewId: 'review-1', revision: 2 })
    }
  })

  it('rejects cross-property access before recording any fact', async () => {
    const live = await seedLive(ORG_A)
    await clearFacts()

    await expect(
      review(VERIFIED, [])(
        { portalId: live.portal, reviewId: 'review-1', revision: 1 },
        ctxOf(ORG_A),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(await factsOf(ORG_A)).toEqual([])
  })

  it('rejects review completion for non-published content', async () => {
    const live = await seedDraft(ORG_A)

    await expect(
      review()(
        { portalId: live.portal, reviewId: 'review-1', revision: 1 },
        ctxOf(ORG_A),
      ),
    ).rejects.toMatchObject({ code: 'invalid_publication_transition' })
    expect(await factsOf(ORG_A)).toEqual([])
  })

  it('does not reach a Portal of another organization', async () => {
    const live = await seedLive(ORG_A)
    await clearFacts()

    await expect(
      review()(
        { portalId: live.portal, reviewId: 'review-1', revision: 1 },
        ctxOf(ORG_B),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
    expect(await factsOf(ORG_A)).toEqual([])
    expect(await factsOf(ORG_B)).toEqual([])
  })
})
