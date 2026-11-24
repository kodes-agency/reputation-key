import { expect } from 'vitest'
import type { PropertyGoogleReviewDestinationPublicApi } from '#/contexts/property/public-api'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/monthly-goals/portal-rating-goal-guard.server'
import { getDb } from '#/shared/db'
import { freshBase64Url, freshUuid } from '#/shared/testing/fresh-uuid'
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
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { staffApiOf } from '#/shared/testing/staff-public-api-stub'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { issuePortalToken } from '../addresses/issue-portal-token.server'
import {
  publishPortalChanges,
  publishPortalsChanges,
} from './publish-portal-changes.server'
import { rollbackPortalPublication } from './rollback-portal-publication.server'
import { createPortalRepository } from './portal-repository.server'
import { createPortalPublicationRepository } from './portal-publication-repository.server'
import { createPortalTokenRepository } from '../addresses/portal-token-repository.server'
import { testPortalTokenCodec } from '../addresses/portal-token-codec.test-fixtures'
import {
  publishFromSource,
  republishFromSource,
} from './portal-working-copy-publish.test-fixtures'
import {
  seedPortalLookOverride,
  seedPortalWorkingCopy,
  type PortalWorkingCopySeed,
} from './portal-working-copy-seed.test-fixtures'
import type { PortalCommandStore } from './portal-command-store-port.server'
import { createAtomicPortalCommandStore } from './portal-command-store.server'

export const ORG_A = organizationId('org-publication-lifecycle-000001')
export const ORG_B = organizationId('org-publication-lifecycle-000002')
export const MANAGER = userId('manager-publication-lifecycle-001')
export const NOW = new Date('2026-09-30T12:00:00.000Z')
export const EDITED_AT = new Date('2026-09-01T09:00:00.000Z')
export const LIVE_DESTINATION = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=working-copy',
  retrievedAt: new Date('2026-08-26T10:00:00.000Z'),
  sourceEpoch: 1,
  profileVersion: 1,
} as const
export const RELINKED_DESTINATION = {
  ...LIVE_DESTINATION,
  retrievedAt: new Date(NOW.getTime() + 1_000),
  sourceEpoch: LIVE_DESTINATION.sourceEpoch + 1,
  profileVersion: LIVE_DESTINATION.profileVersion + 1,
} as const

let poolOf: ReturnType<typeof setupIntegrationDb>['getPool'] | undefined

export const getPool = () => {
  if (!poolOf) throw new Error('setupLifecycleDb() has not run in this file')
  return poolOf()
}

/** Registers the database and event-schema hooks; call once at the top of each lifecycle test file. */
export function setupLifecycleDb(): void {
  poolOf = setupIntegrationDb({
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
  }).getPool
}

export const ratingGoalGuard = createPortalRatingGoalGuard()
export const publicationRepo = () => createPortalPublicationRepository(getDb())

export type Destination = Awaited<
  ReturnType<PropertyGoogleReviewDestinationPublicApi['getGoogleReviewDestination']>
>
export const UNAVAILABLE_DESTINATION: Destination = {
  state: 'unavailable',
  uri: null,
  retrievedAt: null,
  sourceEpoch: null,
  profileVersion: null,
}

export type Options = Readonly<{
  accessible?: ReadonlyArray<PropertyId> | null
  destination?: Destination
  propertyActive?: boolean
  wrapStore?: (store: PortalCommandStore) => PortalCommandStore
}>

export function wire(options: Options = {}) {
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
    staffPublicApi: staffApiOf(options.accessible ?? null),
    idGen: freshUuid,
    clock: () => NOW,
  }
  return {
    publish: publishPortalChanges(deps),
    publishMany: publishPortalsChanges(deps),
    rollback: rollbackPortalPublication({
      portalRepo: deps.portalRepo,
      publicationRepo: deps.publicationRepo,
      commandStore: deps.commandStore,
      staffPublicApi: deps.staffPublicApi,
      idGen: freshUuid,
      clock: () => NOW,
    }),
    issue: issuePortalToken({
      portalRepo: deps.portalRepo,
      portalTokenRepo: deps.portalTokenRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: deps.commandStore,
      tokenCodec: testPortalTokenCodec(
        () => `pt_${freshBase64Url(12)}_${freshBase64Url(32)}`,
      ),
      addressCipher: null,
      reportPrintCodeProblem: () => undefined,
      idGen: freshUuid,
      clock: () => NOW,
      address: {
        appOrigin: 'https://app.example.test',
        printOrigin: 'https://ap.example.test',
      },
    }),
  }
}

export const ctxOf = (
  org: OrganizationId,
  role: AuthContext['role'] = 'PropertyManager',
): AuthContext => buildTestAuthContext({ organizationId: org, userId: MANAGER, role })

export type Live = Readonly<{
  org: OrganizationId
  property: PropertyId
  portal: PortalId
  seed: PortalWorkingCopySeed
}>

export type DraftOptions = Readonly<{
  wordmark?: string
  personalName?: string
  /** Stays a draft; `true` publishes nothing and records no live version. */
  published?: boolean
}>

/** A Portal of a new Property with a Brand Profile and English wording, not live yet. */
export async function seedDraft(
  org: OrganizationId,
  options: DraftOptions = {},
): Promise<Live> {
  const property = propertyId(freshUuid())
  const portal = portalId(freshUuid())
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
    categoryId: freshUuid(),
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

export const scopeOf = (live: Live) => ({
  organizationId: live.org,
  propertyId: live.property,
  portalId: live.portal,
})

export async function sourceOf(live: Live) {
  const source = await publicationRepo().loadWorkingCopy(live.org, live.portal)
  if (!source) throw new Error('the Portal has no working copy')
  return source
}

/** The first version, published from the draft as it is, the way a first publication writes it. */
export async function goLive(live: Live): Promise<Live> {
  await publishFromSource(scopeOf(live), await sourceOf(live), ratingGoalGuard)
  return live
}

/** A second version of the draft as it is now, live in place of the first. */
export async function republish(live: Live): Promise<void> {
  await republishFromSource(scopeOf(live), await sourceOf(live), ratingGoalGuard)
}

export async function seedLive(
  org: OrganizationId,
  options: DraftOptions = {},
): Promise<Live> {
  return goLive(await seedDraft(org, options))
}

export type Address = 'current' | 'older' | 'none'

/** The Portal's printed address, issued through the real use case. */
export async function giveAddress(
  live: Live,
  address: Address = 'current',
): Promise<void> {
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
export async function seedReady(
  org: OrganizationId,
  options: DraftOptions & Readonly<{ address?: Address }> = {},
): Promise<Live> {
  const live = await seedLive(org, options)
  await giveAddress(live, options.address)
  await clearFacts()
  return live
}

export const clearFacts = () =>
  getPool().query(`DELETE FROM outbox_events WHERE organization_id = ANY($1)`, [
    [ORG_A, ORG_B],
  ])

/** The Property rewords its welcome title: the draft moves, the Portal row does not. */
export const rewordWelcome = (live: Live, title: string) =>
  getPool().query(
    `UPDATE property_portal_brand_contents SET title = $2
      WHERE organization_id = $1 AND property_id = $3 AND locale = 'en'`,
    [live.org, title, live.property],
  )

export const setState = (live: Live, state: string) =>
  getPool().query(
    `UPDATE portals SET publication_state = $3 WHERE organization_id = $1 AND id = $2`,
    [live.org, live.portal, state],
  )

export const snapshotsOf = async (live: Live) =>
  (
    await getPool().query(
      `SELECT id, version, created_by, created_at, destination_uri, destination_source_epoch,
              configuration_digest
       FROM portal_publication_snapshots
       WHERE organization_id = $1 AND portal_id = $2 ORDER BY version`,
      [live.org, live.portal],
    )
  ).rows

export const activationsOf = async (live: Live) =>
  (
    await getPool().query(
      `SELECT snapshot_id, activation_sequence, kind, activated_by, activated_at,
              deactivated_at, deactivation_reason
       FROM portal_publication_activations
       WHERE organization_id = $1 AND portal_id = $2 ORDER BY activation_sequence`,
      [live.org, live.portal],
    )
  ).rows

export const portalRow = async (live: Live) =>
  (
    await getPool().query(
      `SELECT name, slug, theme, publication_state, updated_at FROM portals
       WHERE organization_id = $1 AND id = $2`,
      [live.org, live.portal],
    )
  ).rows[0]

export const factsOf = async (org: OrganizationId, tag?: string) =>
  (
    await getPool().query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload FROM outbox_events
       WHERE organization_id = $1 AND ($2::text IS NULL OR event_type = $2)
       ORDER BY created_at, event_type`,
      [org, tag ?? null],
    )
  ).rows

export const publicationFacts = async (org: OrganizationId) =>
  (await factsOf(org)).filter((row) => row.event_type.startsWith('portal.publication.'))

export async function expectNothingWritten(live: Live, versions = 1): Promise<void> {
  expect(await snapshotsOf(live)).toHaveLength(versions)
  expect(await activationsOf(live)).toHaveLength(versions)
  expect(await factsOf(live.org)).toEqual([])
}
/** Publishing is refused with `code` and nothing is written. */
export async function expectPublishRefused(
  live: Live,
  code: string,
  options: Options = {},
  versions = 1,
): Promise<void> {
  await expect(
    wire(options).publish({ portalId: live.portal }, ctxOf(live.org)),
  ).rejects.toMatchObject({ code })
  await expectNothingWritten(live, versions)
}

/** Gives the Portal a Portal-written wordmark, which is the look override a personal name may not appear in. */
export const seedWordmarkOverride = (live: Live) =>
  seedPortalLookOverride(getPool(), live.seed, {
    identity: { wordmark: 'MARCO', logoAssetId: null },
    lookVersion: 2,
  })

export const markResponsibilityNeeded = (live: Live) =>
  getPool().query(
    `UPDATE portals SET responsibility_needed_since = $3
      WHERE organization_id = $1 AND id = $2`,
    [live.org, live.portal, NOW],
  )

/** The readiness gates a publication asks. */
export const READINESS_GATES: ReadonlyArray<{
  key: string
  title: string
  seed: Readonly<{ address?: Address }>
  wire: Options
  sabotage?: (live: Live) => Promise<unknown>
  code: string
}> = [
  {
    key: 'hasAddress',
    title: 'needs a public address',
    seed: { address: 'none' },
    wire: {},
    code: 'token_unavailable',
  },
  {
    key: 'propertyActive',
    title: 'needs an active Property',
    seed: {},
    wire: { propertyActive: false },
    code: 'portal_inactive',
  },
  {
    key: 'destination',
    title: 'needs a verified Google review destination',
    seed: {},
    wire: { destination: UNAVAILABLE_DESTINATION },
    code: 'google_review_destination_unavailable',
  },
  {
    key: 'responsibility',
    title: 'needs a responsible manager',
    seed: {},
    wire: {},
    sabotage: markResponsibilityNeeded,
    code: 'responsible_manager_ineligible',
  },
]
