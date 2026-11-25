// Test-only: the world, ids and seeds the Portal intent integration suites share.
// The real intents run over the real repositories and the atomic command store;
// the Property lifecycle and Google destination are counted stand-ins.

import { freshUuid } from '#/shared/testing/fresh-uuid'
import type { Pool } from 'pg'
import { vi } from 'vitest'
import { getDb } from '#/shared/db'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { organizationId, propertyId, userId, type PropertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/monthly-goals/portal-rating-goal-guard.server'
import { archivePersonalPortal } from '../personal-portals/archive-personal-portal.server'
import { createPortalPublicationRepository } from './portal-publication-repository.server'
import { createPortalRepository } from './portal-repository.server'
import { createPortalTokenRepository } from '../addresses/portal-token-repository.server'
import {
  PORTAL_CREATION_TABLES,
  seedCreationPortal,
  seedCreationProperty,
  seedCreationToken,
  VERIFIED_GOOGLE_DESTINATION,
} from '../infrastructure/testing/portal-creation-world'
import { publishFromSource } from './portal-working-copy-publish.test-fixtures'
import { createCreationQueries } from './portal-creation-queries.test-fixtures'
import {
  archivePortal,
  changePortalLanguages,
  disablePortal,
  publishPortal,
  restorePortal,
  updatePortalSettings,
} from './portal-intents.server'
import { createAtomicPortalCommandStore } from './portal-command-store.server'

export const ORG_A = organizationId('org-intents-0000-0000-000000000001')
export const ORG_B = organizationId('org-intents-0000-0000-000000000002')
export const PROPERTY = propertyId('c3a10000-0000-4000-8000-000000000001')
export const NO_BRAND_PROPERTY = propertyId('c3a10000-0000-4000-8000-000000000002')
export const NO_WORDING_PROPERTY = propertyId('c3a10000-0000-4000-8000-000000000003')
export const PROPERTY_B = propertyId('c3a10000-0000-4000-8000-00000000000b')
export const PORTAL = 'c3b10000-0000-4000-8000-000000000001'
export const PORTAL_B = 'c3b10000-0000-4000-8000-0000000000b1'
export const MISSING = 'c3b10000-0000-4000-8000-0000000000ff'
export const GROUP = 'c3a20000-0000-4000-8000-000000000001'
export const CLOCK = new Date('2026-10-01T12:00:00.000Z')
export const NEXT = new Date(CLOCK.getTime() + 1)
export const MANAGER = userId('manager-intents-0000-000000000001')

export const asRole = (
  role: 'PropertyManager' | 'AccountAdmin' | 'Member',
  org = ORG_A,
) => buildTestAuthContext({ organizationId: org, userId: MANAGER, role })
export const manager = asRole('PropertyManager')

export const TEST_ORGANIZATIONS = { orgA: ORG_A, orgB: ORG_B }

export const INTENT_TABLES = [
  'goal_subject_assignments',
  'goal_program_versions',
  'goal_programs',
  ...PORTAL_CREATION_TABLES,
]

const ratingGoalGuard = createPortalRatingGoalGuard()

const WORDING = [
  {
    locale: 'en',
    title: 'Welcome to Harbor',
    shortDescription: 'Tell us about your visit.',
  },
  {
    locale: 'bg',
    title: 'Добре дошли',
    shortDescription: 'Разкажете ни за посещението.',
  },
]

/** The Properties every test starts with. */
export async function seedIntentProperties(pool: Pool) {
  const brand = { displayName: 'Harbor', defaultGuestLocales: ['en'], wording: WORDING }
  await seedCreationProperty(pool, { organizationId: ORG_A, propertyId: PROPERTY, brand })
  await seedCreationProperty(pool, {
    organizationId: ORG_B,
    propertyId: PROPERTY_B,
    brand,
  })
  await seedCreationProperty(pool, {
    organizationId: ORG_A,
    propertyId: NO_WORDING_PROPERTY,
    brand: { ...brand, wording: [] },
  })
  // A Property that has wording but no Brand Profile.
  await seedCreationProperty(pool, {
    organizationId: ORG_A,
    propertyId: NO_BRAND_PROPERTY,
  })
  await pool.query(
    `INSERT INTO property_portal_brand_contents
       (id, organization_id, property_id, locale, title, short_description, version,
        updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'en', 'Welcome', 'Tell us about your visit.', 1, 'seed-manager', $4, $4)`,
    [freshUuid(), ORG_A, NO_BRAND_PROPERTY, CLOCK],
  )
}

export type World = Readonly<{
  accessible?: ReadonlyArray<PropertyId> | null
  destination?: 'verified' | 'unavailable'
  lifecycle?: 'active' | 'inactive' | 'error'
}>

export function world(options: World = {}) {
  const db = getDb()
  const calls = { destination: 0, lifecycle: 0 }
  const commandStore = createAtomicPortalCommandStore(db, ratingGoalGuard)
  const updatePortalWrites = vi.spyOn(commandStore, 'updatePortal')
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () =>
      options.accessible === undefined ? null : options.accessible,
    getAssignedPortals: async () => [],
  }
  const deps = {
    ratingGoalGuard: {
      findRunningRatingGoalBlock: (org: string, property: string, portal: string) =>
        db.transaction((tx) =>
          ratingGoalGuard.findPortalRatingGoalBlockInTransaction(tx, {
            organizationId: org as never,
            propertyId: property as never,
            portalId: portal as never,
            at: CLOCK,
          }),
        ),
    },
    portalRepo: createPortalRepository(db),
    commandStore,
    publicationRepo: createPortalPublicationRepository(db),
    portalTokenRepo: createPortalTokenRepository(db),
    propertyGoogleReviewDestinationApi: {
      getGoogleReviewDestination: async () => {
        calls.destination += 1
        return options.destination === 'unavailable'
          ? {
              state: 'unavailable' as const,
              uri: null,
              retrievedAt: null,
              sourceEpoch: null,
              profileVersion: null,
            }
          : VERIFIED_GOOGLE_DESTINATION
      },
    },
    propertyLifecycleApi: {
      isPropertyActive: async () => {
        calls.lifecycle += 1
        if (options.lifecycle === 'error') {
          throw new Error('Property lifecycle authority unavailable')
        }
        return options.lifecycle !== 'inactive'
      },
    },
    staffPublicApi,
    idGen: freshUuid,
    clock: () => CLOCK,
  }
  return {
    settings: updatePortalSettings(deps),
    languages: changePortalLanguages(deps),
    publish: publishPortal(deps),
    disable: disablePortal(deps),
    archive: archivePortal(deps),
    restore: restorePortal(deps),
    archivePerson: archivePersonalPortal(deps),
    archiveForDeparture: archivePersonalPortal(deps, true),
    calls,
    writes: () => updatePortalWrites.mock.calls.length,
  }
}

export type SeedOptions = Readonly<{
  id?: string
  org?: typeof ORG_A | typeof ORG_B
  property?: PropertyId
  state?: 'draft' | 'published' | 'disabled' | 'archived'
  slug?: string
  name?: string
  kind?: 'place' | 'personal'
  publicName?: string
  description?: string | null
  additional?: readonly string[]
  skipPrivateRating?: boolean
  withToken?: boolean
  /** The Portal's revision is the clock's, so the next one is a millisecond later. */
  atClock?: boolean
  heroImageUrl?: string
}>

export function createIntentsHarness(getPool: () => Pool) {
  const { rows, countOf } = createCreationQueries(getPool, ORG_A)

  /** A Portal in the state asked for; a live one is published for real, with its snapshot and activation. */
  async function seedPortal(options: SeedOptions = {}): Promise<string> {
    const id = options.id ?? PORTAL
    const org = options.org ?? ORG_A
    const property = options.property ?? PROPERTY
    const state = options.state ?? 'draft'
    const scope = { organizationId: org, propertyId: property, portalId: id }
    await seedCreationPortal(getPool(), {
      ...scope,
      slug: options.slug ?? 'test-portal',
      name: options.name ?? 'Test Portal',
      kind: options.kind,
      publicName: options.publicName ?? null,
      description: options.description,
      additionalGuestLocales: options.additional,
      skipPrivateRating: options.skipPrivateRating,
      publicationState: state === 'published' ? 'draft' : state,
    })
    if (options.heroImageUrl) {
      await getPool().query(`UPDATE portals SET hero_image_url = $2 WHERE id = $1`, [
        id,
        options.heroImageUrl,
      ])
    }
    if (options.withToken !== false && org === ORG_A) {
      await seedCreationToken({
        ...scope,
        tokenId: `c3a70000-0000-4000-8000-${id.slice(-12)}`,
        identifier: `intents-${id.slice(-12)}`,
      })
    }
    if (state === 'published') {
      const working = await createPortalPublicationRepository(getDb()).loadWorkingCopy(
        org,
        id as never,
      )
      if (!working) throw new Error('the seeded Portal has no working copy')
      await publishFromSource(scope as never, working, ratingGoalGuard)
    }
    if (options.atClock) {
      await getPool().query(`UPDATE portals SET updated_at = $2 WHERE id = $1`, [
        id,
        CLOCK,
      ])
    }
    return id
  }

  const portalRow = async (id = PORTAL) =>
    (await rows(`SELECT * FROM portals WHERE id = $1`, id))[0]

  const outboxCount = (org = ORG_A) => countOf('outbox_events', org)

  const factsOf = (tag: string, org = ORG_A) =>
    rows(
      `SELECT payload FROM outbox_events WHERE organization_id = $1 AND event_type = $2
     ORDER BY created_at`,
      org,
      tag,
    ).then((found) => found.map((row) => row.payload))

  const snapshotsOf = (id = PORTAL) =>
    rows(
      `SELECT id, version, configuration, configuration_digest, language_pack_versions
     FROM portal_publication_snapshots WHERE portal_id = $1 ORDER BY version`,
      id,
    )

  const activationsOf = (id = PORTAL) =>
    rows(
      `SELECT activation_sequence, kind, deactivated_at, deactivation_reason
     FROM portal_publication_activations WHERE portal_id = $1 ORDER BY activation_sequence`,
      id,
    )

  /** Everything a refused command could have changed. */
  const footprint = async (id = PORTAL) => ({
    portal: await portalRow(id),
    outbox: await outboxCount(),
    snapshots: await countOf('portal_publication_snapshots'),
    activations: await countOf('portal_publication_activations'),
    health: await countOf('portal_health_intervals'),
  })

  return {
    rows,
    countOf,
    seedPortal,
    portalRow,
    outboxCount,
    factsOf,
    snapshotsOf,
    activationsOf,
    footprint,
  }
}
