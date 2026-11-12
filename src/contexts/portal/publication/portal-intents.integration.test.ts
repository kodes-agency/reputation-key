// The Portal intents (settings, address, languages, publish, disable, archive, restore)
// over the real repositories and the atomic command store on PostgreSQL, for two
// Organizations: what each one commits (rows, snapshots, activations, outbox facts) and
// what a refusal leaves behind (nothing).

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, propertyId, userId, type PropertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import {
  METRIC_DEFINITION_IDS,
  METRIC_VERSION_IDS,
} from '#/contexts/reporting/application/public-api'
import { toPublicPortalLoaderData } from '#/contexts/guest/application/dto/public-portal.dto'
import { printKitFileName } from '#/shared/domain/portal-print-kit'
import {
  printFinalDocumentTitle,
  printFinalFileName,
} from '#/shared/domain/portal-print-final-how-to'
import type { Portal } from '../domain/types'
import type { PortalPublicationSnapshot } from '../domain/portal-publication-snapshot'
import { resolvePublicPortalToken } from '../application/use-cases/resolve-public-portal-token'
import { loadPortalPrintKitContext } from '../application/load-portal-print-kit-context'
import { archivePersonalPortal } from '../application/use-cases/archive-personal-portal'
import { reviewedPublicationDigest } from '../application/portal-publication-snapshot'
import { isPortalError } from '../domain/errors'
import { createPortalPublicationRepository } from '../infrastructure/repositories/portal-publication.repository'
import { createPortalRepository } from '../infrastructure/repositories/portal.repository'
import { createPortalTokenRepository } from '../infrastructure/repositories/portal-token.repository'
import {
  PORTAL_CREATION_TABLES,
  seedCreationPortal,
  seedCreationProperty,
  seedCreationToken,
  VERIFIED_GOOGLE_DESTINATION,
} from '../infrastructure/testing/portal-creation-world'
import { publishFromSource } from '../infrastructure/testing/portal-working-copy-publish'
import {
  archivePortal,
  changePortalLanguages,
  changePortalSlug,
  disablePortal,
  publishPortal,
  restorePortal,
  updatePortalSettings,
} from './portal-intents.server'
import { createAtomicPortalCommandStore } from './portal-command-store.server'

const ORG_A = organizationId('org-intents-0000-0000-000000000001')
const ORG_B = organizationId('org-intents-0000-0000-000000000002')
const PROPERTY = propertyId('c3a10000-0000-4000-8000-000000000001')
const NO_BRAND_PROPERTY = propertyId('c3a10000-0000-4000-8000-000000000002')
const NO_WORDING_PROPERTY = propertyId('c3a10000-0000-4000-8000-000000000003')
const PROPERTY_B = propertyId('c3a10000-0000-4000-8000-00000000000b')
const PORTAL = 'c3b10000-0000-4000-8000-000000000001'
const PORTAL_TWO = 'c3b10000-0000-4000-8000-000000000002'
const PORTAL_B = 'c3b10000-0000-4000-8000-0000000000b1'
const MISSING = 'c3b10000-0000-4000-8000-0000000000ff'
const GROUP = 'c3a20000-0000-4000-8000-000000000001'
const CLOCK = new Date('2026-10-01T12:00:00.000Z')
const NEXT = new Date(CLOCK.getTime() + 1)
const MANAGER = userId('manager-intents-0000-000000000001')

const asRole = (role: 'PropertyManager' | 'AccountAdmin' | 'Member', org = ORG_A) =>
  buildTestAuthContext({ organizationId: org, userId: MANAGER, role })
const manager = asRole('PropertyManager')

const ratingGoalGuard = createPortalRatingGoalGuard()

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'goal_subject_assignments',
    'goal_program_versions',
    'goal_programs',
    ...PORTAL_CREATION_TABLES,
  ],
})

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

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  const pool = getPool()
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
    [randomUUID(), ORG_A, NO_BRAND_PROPERTY, CLOCK],
  )
})

type World = Readonly<{
  accessible?: ReadonlyArray<PropertyId> | null
  destination?: 'verified' | 'unavailable'
  lifecycle?: 'active' | 'inactive' | 'error'
}>

function world(options: World = {}) {
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
    idGen: randomUUID,
    clock: () => CLOCK,
  }
  return {
    settings: updatePortalSettings(deps),
    slug: changePortalSlug(deps),
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

type SeedOptions = Readonly<{
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
    await getPool().query(`UPDATE portals SET updated_at = $2 WHERE id = $1`, [id, CLOCK])
  }
  return id
}

const rows = async (sql: string, ...values: unknown[]) =>
  (await getPool().query(sql, values)).rows

const portalRow = async (id = PORTAL) =>
  (await rows(`SELECT * FROM portals WHERE id = $1`, id))[0]

const countOf = async (table: string, org = ORG_A) =>
  Number(
    (
      await rows(
        `SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`,
        org,
      )
    )[0].n,
  )

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

/** Runs the actual guest and print projections on a personal Portal's first snapshot. */
async function expectPersonalPortalNameStaysPrivate(
  portal: Portal,
  snapshot: PortalPublicationSnapshot,
) {
  const config = snapshot.configuration
  const resolve = resolvePublicPortalToken({
    tokenCodec: {
      digest: () => ({
        kind: 'long',
        tokenIdentifier: 'key',
        tokenHash: 'hash',
        tokenKeyVersion: 1,
      }),
    },
    portalPublicationRepo: {
      resolveActiveByTokenDigest: async () => ({
        snapshot,
        token: {
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
          portalId: portal.id,
          version: 1,
        },
      }),
    },
    portalHealthRepo: {
      getCurrent: async () => ({
        id: 'health',
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        portalId: portal.id,
        status: 'healthy',
        reason: 'operational',
        sourceVersion: '1',
        effectiveFrom: snapshot.createdAt,
        effectiveTo: null,
        observedAt: snapshot.createdAt,
      }),
    },
    listApprovedSecondaryDestinationUris: async (_org, _property, uris) => uris,
    isPropertyActive: async () => true,
    getGoogleReviewDestination: async () => ({
      state: 'verified',
      uri: config.reviewGateway.googleReview.uri,
      retrievedAt: new Date(config.googleReviewBinding.retrievedAt),
      sourceEpoch: config.googleReviewBinding.sourceEpoch,
      profileVersion: config.googleReviewBinding.profileVersion,
    }),
    decidePublic: async () => ({ allowed: true }),
    clock: () => snapshot.createdAt,
  })
  const resolved = await resolve('pt_key_secret')
  expect(resolved.status).toBe('found')
  if (resolved.status !== 'found') throw new Error('The personal Portal must resolve')
  const loader = toPublicPortalLoaderData(resolved.data, {
    servedAt: snapshot.createdAt.toISOString(),
    guestSession: { csrfNonce: 'nonce' },
    response: null,
    responseForm: { availability: 'available' },
  })
  const print = await loadPortalPrintKitContext(
    {
      publicationRepo: {
        findActiveForPortal: async () => snapshot,
        loadWorkingCopy: async () => null,
      },
    },
    { organizationId: portal.organizationId, portal },
  )
  const metadata = {
    kitTitle: `${print.portalName} counter card`,
    kitFile: printKitFileName(print.portalName, 'counter_card', ['en'], {
      style: 'paper',
      paper: 'letter',
    }),
    finalTitle: printFinalDocumentTitle(print.portalName, 'counter'),
    finalFile: printFinalFileName(print.portalName, {
      piece: 'counter',
      orientation: 'upright',
      look: 'paper',
      paper: 'letter',
      printer: 'my_printer',
      languages: ['en'],
    }),
  }
  expect(portal.name).toBe('Polly Smith')
  expect(portal.slug).toMatch(/^portal-[a-f0-9]+$/)
  for (const output of [snapshot, loader, resolved.data.portal.slug, metadata])
    expect(JSON.stringify(output)).not.toMatch(/polly|smith/i)
}

const codeOf = async (run: Promise<unknown>): Promise<string | undefined> => {
  try {
    await run
  } catch (error) {
    return isPortalError(error) ? error.code : 'not-a-portal-error'
  }
  return undefined
}

describe.sequential('portal intents', () => {
  it('updates name and theme', async () => {
    const { settings } = world()
    await seedPortal({ name: 'Old Name' })

    const updated = await settings(
      { portalId: PORTAL, name: 'New Name', theme: { primaryColor: '#FF5500' } },
      manager,
    )

    expect(updated.name).toBe('New Name')
    expect(updated.theme.primaryColor).toBe('#FF5500')
    expect(await portalRow()).toMatchObject({
      name: 'New Name',
      theme: { primaryColor: '#FF5500' },
    })
  })

  it('updates slug', async () => {
    const { slug } = world()
    await seedPortal({ slug: 'old-slug' })
    expect((await slug({ portalId: PORTAL, slug: 'new-slug' }, manager)).slug).toBe(
      'new-slug',
    )
    expect((await portalRow()).slug).toBe('new-slug')
  })

  it('rejects users who cannot edit', async () => {
    const { settings } = world()
    await seedPortal()
    const before = await footprint()
    expect(
      await codeOf(settings({ portalId: PORTAL, name: 'Test' }, asRole('Member'))),
    ).toBe('forbidden')
    expect(await footprint()).toEqual(before)
  })

  it('rejects update to non-existent portal', async () => {
    const { settings } = world()
    expect(await codeOf(settings({ portalId: MISSING, name: 'Test' }, manager))).toBe(
      'portal_not_found',
    )
  })

  it('treats a Portal of another organization as unknown and leaves it alone', async () => {
    const { settings, slug, publish, archive } = world()
    await seedPortal({ id: PORTAL_B, org: ORG_B, property: PROPERTY_B, name: 'Theirs' })
    const admin = asRole('AccountAdmin')
    for (const run of [
      () => settings({ portalId: PORTAL_B, name: 'Mine now' }, admin),
      () => slug({ portalId: PORTAL_B, slug: 'mine-now' }, admin),
      () => publish({ portalId: PORTAL_B }, admin),
      () => archive({ portalId: PORTAL_B }, admin),
    ]) {
      expect(await codeOf(run())).toBe('portal_not_found')
    }
    expect(await portalRow(PORTAL_B)).toMatchObject({
      name: 'Theirs',
      slug: 'test-portal',
      publication_state: 'draft',
    })
    expect(await outboxCount(ORG_B)).toBe(0)
  })

  it('rejects duplicate slug', async () => {
    const { slug } = world()
    await seedPortal({ slug: 'slug-a' })
    await seedPortal({ id: PORTAL_TWO, slug: 'slug-b' })
    expect(await codeOf(slug({ portalId: PORTAL_TWO, slug: 'slug-a' }, manager))).toBe(
      'slug_taken',
    )
    expect((await portalRow(PORTAL_TWO)).slug).toBe('slug-b')
  })

  it('allows an address another organization holds', async () => {
    const { slug } = world()
    await seedPortal({ slug: 'old' })
    await seedPortal({ id: PORTAL_B, org: ORG_B, property: PROPERTY_B, slug: 'taken' })
    expect((await slug({ portalId: PORTAL, slug: 'taken' }, manager)).slug).toBe('taken')
  })

  it('reports an invalid publication transition for an archived Portal', async () => {
    const { publish } = world()
    await seedPortal({ state: 'archived' })
    expect(await codeOf(publish({ portalId: PORTAL }, manager))).toBe(
      'invalid_publication_transition',
    )
  })

  it('restores an archived Portal to Disabled without a destination or publication activation', async () => {
    const { restore, calls } = world()
    await seedPortal({ state: 'archived', atClock: true })

    const restored = await restore({ portalId: PORTAL }, manager)

    expect(restored.publicationState).toBe('disabled')
    expect((await portalRow()).publication_state).toBe('disabled')
    expect(calls.destination).toBe(0)
    expect(await snapshotsOf()).toEqual([])
    expect(await activationsOf()).toEqual([])
    expect(await factsOf('portal.restored')).toEqual([
      expect.objectContaining({
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalId: PORTAL,
        userId: MANAGER,
        sourceAggregateVersion: NEXT.toISOString(),
        occurredAt: CLOCK.toISOString(),
      }),
    ])
  })

  it('archives a Portal with a dedicated actor-attributed lifecycle fact', async () => {
    const { archive } = world()
    await seedPortal({ state: 'disabled', atClock: true })

    const archived = await archive({ portalId: PORTAL }, asRole('AccountAdmin'))

    expect(archived.publicationState).toBe('archived')
    expect((await portalRow()).publication_state).toBe('archived')
    expect(await factsOf('portal.archived')).toEqual([
      expect.objectContaining({
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalId: PORTAL,
        userId: MANAGER,
        sourceAggregateVersion: NEXT.toISOString(),
        occurredAt: CLOCK.toISOString(),
      }),
    ])
  })

  // Archive is the Portal's removal: it asks `portal.delete`, the permission
  // the Portals pages offer Archive on, whichever command carries it.
  it.each(['draft', 'published', 'disabled'] as const)(
    'refuses a PropertyManager archiving a %s Portal and writes nothing',
    async (state) => {
      const { archive, writes } = world()
      await seedPortal({ state })
      const before = await footprint()

      await expect(archive({ portalId: PORTAL }, manager)).rejects.toMatchObject({
        _tag: 'PortalError',
        code: 'forbidden',
        message: 'this role cannot archive portals',
      })

      expect(writes()).toBe(0)
      expect(await footprint()).toEqual(before)
      expect((await portalRow()).publication_state).toBe(state)
    },
  )

  it('still lets a PropertyManager take a live page down: Disable is an update', async () => {
    const { disable } = world()
    await seedPortal({ state: 'published' })

    const disabled = await disable({ portalId: PORTAL }, manager)

    expect(disabled.publicationState).toBe('disabled')
    expect(await activationsOf()).toEqual([
      expect.objectContaining({ kind: 'publish', deactivation_reason: 'disabled' }),
    ])
  })

  it('keeps an archived Portal read-only until it is restored', async () => {
    const { settings } = world()
    await seedPortal({ state: 'archived', name: 'Archived Reception' })
    const before = await footprint()

    expect(
      await codeOf(
        settings({ portalId: PORTAL, name: 'Edited while archived' }, manager),
      ),
    ).toBe('portal_inactive')

    expect(await footprint()).toEqual(before)
    expect(await portalRow()).toMatchObject({
      name: 'Archived Reception',
      publication_state: 'archived',
    })
  })

  it('restores without touching the retained configuration', async () => {
    const { restore } = world()
    await seedPortal({ state: 'archived', description: 'Retained configuration' })

    await restore({ portalId: PORTAL }, manager)

    expect(await portalRow()).toMatchObject({
      publication_state: 'disabled',
      description: 'Retained configuration',
    })
  })

  it('keeps occurrence time from the clock while allocating a later revision', async () => {
    const { settings, writes } = world()
    await seedPortal({ atClock: true })

    await settings({ portalId: PORTAL, name: 'Updated' }, manager)

    const emitted = await factsOf('portal.updated')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      propertyId: PROPERTY,
      previousPublicationState: 'draft',
      publicationState: 'draft',
      sourceAggregateVersion: NEXT.toISOString(),
      occurredAt: CLOCK.toISOString(),
    })
    expect(emitted[0]).not.toHaveProperty('name')
    expect(emitted[0]).not.toHaveProperty('slug')
    expect((await portalRow()).updated_at).toEqual(NEXT)
    expect(writes()).toBe(1)
    // A settings edit carries no lifecycle fact.
    expect(await outboxCount()).toBe(1)
  })

  it('rejects update with empty name', async () => {
    const { settings } = world()
    await seedPortal({ name: 'Valid Name' })
    expect(await codeOf(settings({ portalId: PORTAL, name: '' }, manager))).toBe(
      'invalid_name',
    )
    expect((await portalRow()).name).toBe('Valid Name')
  })

  it('rejects update with invalid theme', async () => {
    const { settings } = world()
    await seedPortal()
    expect(
      await codeOf(
        settings({ portalId: PORTAL, theme: { primaryColor: 'bad' } }, manager),
      ),
    ).toBe('invalid_theme')
  })

  it('returns existing portal unchanged when no fields are different', async () => {
    const { settings, slug, writes } = world()
    await seedPortal({ name: 'Same Name', slug: 'same-slug' })

    const result = await settings({ portalId: PORTAL, name: 'Same Name' }, manager)
    const sameSlug = await slug({ portalId: PORTAL, slug: 'same-slug' }, manager)

    expect(sameSlug).toEqual(result)
    expect(result.name).toBe('Same Name')
    expect(await factsOf('portal.updated')).toHaveLength(0)
    expect(writes()).toBe(0)
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { settings } = world({ accessible: [] })
    await seedPortal({ name: 'Name' })
    expect(await codeOf(settings({ portalId: PORTAL, name: 'X' }, manager))).toBe(
      'forbidden',
    )
    expect((await portalRow()).name).toBe('Name')
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { settings } = world({ accessible: [PROPERTY] })
    await seedPortal({ name: 'Old' })
    expect((await settings({ portalId: PORTAL, name: 'New' }, manager)).name).toBe('New')
  })

  it('clears the hero image when heroImageUrl is null', async () => {
    const { settings } = world()
    await seedPortal({ heroImageUrl: 'https://cdn.example.com/hero.jpg' })

    const updated = await settings({ portalId: PORTAL, heroImageUrl: null }, manager)

    expect(updated.heroImageUrl).toBeNull()
    expect((await portalRow()).hero_image_url).toBeNull()
  })

  it('rejects a caller-supplied hero image URL', async () => {
    const { settings } = world()
    await seedPortal({ heroImageUrl: 'https://cdn.example.com/old.jpg' })

    const error = await settings(
      {
        portalId: PORTAL,
        heroImageUrl: 'https://cdn.example.com/new.jpg',
      } as unknown as Parameters<typeof settings>[0],
      manager,
    ).catch((e: unknown) => e)

    expect(isPortalError(error) && error.code).toBe('invalid_url')
    expect((await portalRow()).hero_image_url).toBe('https://cdn.example.com/old.jpg')
  })

  it('leaves the hero image untouched when heroImageUrl is absent', async () => {
    const { settings } = world()
    await seedPortal({ heroImageUrl: 'https://cdn.example.com/hero.jpg' })

    const updated = await settings({ portalId: PORTAL, name: 'Renamed' }, manager)

    expect(updated.heroImageUrl).toBe('https://cdn.example.com/hero.jpg')
    expect((await portalRow()).hero_image_url).toBe('https://cdn.example.com/hero.jpg')
  })
})

describe.sequential('publishing', () => {
  it('rejects publishing when the Property has no verified Google destination', async () => {
    const { publish } = world({ destination: 'unavailable' })
    await seedPortal()
    expect(await codeOf(publish({ portalId: PORTAL }, manager))).toBe(
      'google_review_destination_unavailable',
    )
    expect((await portalRow()).publication_state).toBe('draft')
  })

  it('publishes a rating-first gateway without requiring secondary links', async () => {
    const { publish } = world()
    await seedPortal({ atClock: true })

    const updated = await publish({ portalId: PORTAL }, manager)

    expect(updated.publicationState).toBe('published')
    const [snapshot] = await snapshotsOf()
    expect(snapshot).toMatchObject({
      version: 1,
      configuration: {
        reviewGateway: { privateFeedbackThreshold: 4 },
        links: [],
      },
    })
    expect(await activationsOf()).toEqual([
      expect.objectContaining({ activation_sequence: 1, kind: 'publish' }),
    ])
    expect(await factsOf('portal.publication.published')).toEqual([
      expect.objectContaining({
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalId: PORTAL,
        publicationSnapshotId: snapshot.id,
        publicationVersion: 1,
        publicationDigest: snapshot.configuration_digest,
        userId: MANAGER,
        sourceAggregateVersion: NEXT.toISOString(),
        occurredAt: CLOCK.toISOString(),
      }),
    ])
    expect(snapshot.configuration_digest).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('goes live when the draft still says what the manager reviewed', async () => {
    const { publish } = world()
    await seedPortal()
    const working = await createPortalPublicationRepository(getDb()).loadWorkingCopy(
      ORG_A,
      PORTAL as never,
    )
    const reviewedDigest = reviewedPublicationDigest(
      working!,
      VERIFIED_GOOGLE_DESTINATION,
    )

    expect(reviewedDigest).not.toBeNull()
    const updated = await publish(
      { portalId: PORTAL, reviewedDigest: reviewedDigest as string },
      manager,
    )

    expect(updated.publicationState).toBe('published')
    expect((await snapshotsOf())[0].configuration_digest).toBe(reviewedDigest)
  })

  it('refuses to go live when the draft changed after it was reviewed', async () => {
    const { publish, writes } = world()
    await seedPortal()
    const before = await footprint()

    const error = await publish(
      { portalId: PORTAL, reviewedDigest: 'digest-before-the-edit' },
      manager,
    ).catch((e: unknown) => e)

    expect(isPortalError(error) && error.code).toBe('revision_conflict')
    expect((error as Error).message).toBe(
      'The Portal changed after you reviewed it. Review the changes again before publishing',
    )
    expect(writes()).toBe(0)
    expect(await footprint()).toEqual(before)
    expect((await portalRow()).publication_state).toBe('draft')
  })

  it('publishes the new design: schema version 3, in every language the Portal offers', async () => {
    const { publish } = world()
    await seedPortal({ additional: ['bg'] })

    await publish({ portalId: PORTAL }, manager)

    const [snapshot] = await snapshotsOf()
    expect(snapshot.configuration).toMatchObject({
      schemaVersion: 3,
      localeSet: ['en', 'bg'],
    })
    expect(snapshot.language_pack_versions).toEqual({
      en: 'guest-ui-en-v2',
      bg: 'guest-ui-bg-v2',
    })
  })

  it('publishes a Property that has no brand profile, with the default look', async () => {
    const { publish } = world()
    await seedPortal({ property: NO_BRAND_PROPERTY })

    await publish({ portalId: PORTAL }, manager)

    expect((await snapshotsOf())[0].configuration).toMatchObject({
      schemaVersion: 3,
      brandProfile: { lookVersion: 1 },
    })
  })

  it('refuses to publish when the primary language has no wording, and writes nothing', async () => {
    const { publish, writes } = world()
    await seedPortal({ property: NO_WORDING_PROPERTY })
    const before = await footprint()

    const error = await publish({ portalId: PORTAL }, manager).catch((e: unknown) => e)

    expect(isPortalError(error) && error.code).toBe('publication_snapshot_unavailable')
    expect((error as Error).message).toContain('primary language')
    expect(writes()).toBe(0)
    expect(await footprint()).toEqual(before)
  })

  it('fails closed before destination lookup or persistence when the Property is inactive', async () => {
    const { publish, calls, writes } = world({ lifecycle: 'inactive' })
    await seedPortal()
    const before = await footprint()

    await expect(publish({ portalId: PORTAL }, manager)).rejects.toMatchObject({
      code: 'portal_inactive',
    })

    expect(calls.lifecycle).toBe(1)
    expect(calls.destination).toBe(0)
    expect(writes()).toBe(0)
    expect(await footprint()).toEqual(before)
    expect((await portalRow()).publication_state).toBe('draft')
  })

  it('fails closed without leaking a lifecycle lookup error or causing downstream effects', async () => {
    const { publish, calls, writes } = world({ lifecycle: 'error' })
    await seedPortal()
    const before = await footprint()

    await expect(publish({ portalId: PORTAL }, manager)).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'portal_inactive',
      message: 'This Portal cannot be published while its Property is unavailable',
    })

    expect(calls.lifecycle).toBe(1)
    expect(calls.destination).toBe(0)
    expect(writes()).toBe(0)
    expect(await footprint()).toEqual(before)
  })

  it('keeps deactivation available without lifecycle or destination authority', async () => {
    const { disable, calls } = world({ destination: 'unavailable', lifecycle: 'error' })
    await seedPortal({ state: 'published' })

    const updated = await disable({ portalId: PORTAL }, manager)

    expect(updated.publicationState).toBe('disabled')
    expect(await activationsOf()).toEqual([
      expect.objectContaining({ kind: 'publish', deactivation_reason: 'disabled' }),
    ])
    expect(calls.lifecycle).toBe(0)
    expect(calls.destination).toBe(0)
  })

  it('refuses a publish without a verified destination and persists nothing', async () => {
    const { publish } = world({ destination: 'unavailable' })
    await seedPortal({ description: 'Before' })
    const before = await footprint()

    expect(await codeOf(publish({ portalId: PORTAL }, manager))).toBe(
      'google_review_destination_unavailable',
    )

    expect(await footprint()).toEqual(before)
    expect(await portalRow()).toMatchObject({
      publication_state: 'draft',
      description: 'Before',
    })
  })

  it('refuses to go live when nobody is responsible or the code does not resolve', async () => {
    const { publish } = world()
    await seedPortal({ withToken: false })
    expect(await codeOf(publish({ portalId: PORTAL }, manager))).toBe('token_unavailable')
    expect((await portalRow()).publication_state).toBe('draft')
  })

  it('never consults the destination when the update leaves publication state alone', async () => {
    const { settings, calls } = world()
    await seedPortal({ description: 'Before' })

    const updated = await settings({ portalId: PORTAL, description: 'After' }, manager)

    expect(updated.description).toBe('After')
    expect(updated.publicationState).toBe('draft')
    expect(calls.destination).toBe(0)
  })

  // A portal that is ALREADY published (pre-precondition data) must
  // stay editable: re-asserting the current state is not a transition.
  it('never consults the destination or writes when the Portal is already published', async () => {
    const { publish, calls, writes } = world()
    await seedPortal({ state: 'published' })
    const before = await footprint()

    const updated = await publish({ portalId: PORTAL }, manager)

    expect(updated.publicationState).toBe('published')
    expect(calls.destination).toBe(0)
    expect(writes()).toBe(0)
    expect(await footprint()).toEqual(before)
  })
})

describe.sequential('changePortalLanguages', () => {
  it('records the locale-set fact when the languages change', async () => {
    const { languages } = world()
    await seedPortal()

    const updated = await languages(
      { portalId: PORTAL, primaryGuestLocale: 'en', additionalGuestLocales: ['bg'] },
      manager,
    )

    expect(updated.additionalGuestLocales).toEqual(['bg'])
    expect((await portalRow()).additional_guest_locales).toEqual(['bg'])
    const facts = await rows(
      `SELECT payload FROM outbox_events
       WHERE organization_id = $1 AND payload->>'portalId' = $2 AND event_type <> 'portal.updated'`,
      ORG_A,
      PORTAL,
    )
    expect(facts.map((fact) => fact.payload)).toEqual([
      expect.objectContaining({
        portalId: PORTAL,
        primaryGuestLocale: 'en',
        additionalGuestLocales: ['bg'],
      }),
    ])
  })

  it('refuses a repeat of the primary language and writes nothing', async () => {
    const { languages, writes } = world()
    await seedPortal()
    const before = await footprint()
    await expect(
      languages({ portalId: PORTAL, additionalGuestLocales: ['en'] }, manager),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
    expect(writes()).toBe(0)
    expect(await footprint()).toEqual(before)
  })

  it('keeps an archived Portal read-only', async () => {
    const { languages } = world()
    await seedPortal({ state: 'archived' })
    await expect(
      languages({ portalId: PORTAL, additionalGuestLocales: ['bg'] }, manager),
    ).rejects.toMatchObject({ code: 'portal_inactive' })
  })
})

describe.sequential('skip private rating through the goal port', () => {
  async function seedGoal(
    subject: Readonly<{ kind: 'portal'; portalId: string } | { kind: 'portal_group' }>,
  ) {
    const [programId, versionId] = [randomUUID(), randomUUID()]
    const pool = getPool()
    await pool.query(
      `INSERT INTO goal_programs (id, organization_id, property_id, name, status, created_by)
       VALUES ($1, $2, $3, 'Target', 'active', 'test')`,
      [programId, ORG_A, PROPERTY],
    )
    await pool.query(
      `INSERT INTO goal_program_versions
         (id, program_id, organization_id, property_id, version, metric_definition_id,
          metric_definition_version_id, metric_key, metric_minimum_sample, target_value,
          property_timezone, effective_from, change_reason, created_by)
       VALUES ($1, $2, $3, $4, 1, $5, $6, 'portal_rating_count', 0, 25, 'Europe/Sofia', $7,
               'created', 'test')`,
      [
        versionId,
        programId,
        ORG_A,
        PROPERTY,
        METRIC_DEFINITION_IDS.portalRatingCount,
        METRIC_VERSION_IDS.portalRatingCountGoal,
        new Date('2026-09-01T00:00:00.000Z'),
      ],
    )
    await pool.query(
      `INSERT INTO goal_subject_assignments
         (id, program_id, program_version_id, organization_id, property_id, metric_key,
          subject_kind, portal_id, portal_group_id, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, 'portal_rating_count', $6, $7, $8, $9, 'test')`,
      [
        randomUUID(),
        programId,
        versionId,
        ORG_A,
        PROPERTY,
        subject.kind,
        subject.kind === 'portal' ? subject.portalId : null,
        subject.kind === 'portal_group' ? GROUP : null,
        new Date('2026-09-01T00:00:00.000Z'),
      ],
    )
  }

  it('refuses the switch while this Portal has a running rating goal', async () => {
    const { settings, writes } = world()
    await seedPortal({ state: 'published' })
    await seedGoal({ kind: 'portal', portalId: PORTAL })
    const before = await footprint()

    await expect(
      settings({ portalId: PORTAL, skipPrivateRating: true }, manager),
    ).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'running_rating_goal',
      message: 'This portal has a running goal on private ratings. End the goal first.',
    })

    expect(writes()).toBe(0)
    expect(await footprint()).toEqual(before)
  })

  it('saves the switch when no single-Portal rating goal holds it', async () => {
    const { settings, writes } = world()
    await seedPortal({ state: 'published' })

    const saved = await settings({ portalId: PORTAL, skipPrivateRating: true }, manager)

    expect(saved.skipPrivateRating).toBe(true)
    expect((await portalRow()).skip_private_rating).toBe(true)
    expect(writes()).toBe(1)
  })

  it('does not let a goal of another organization hold the switch', async () => {
    const { settings } = world()
    await seedPortal({ state: 'published' })
    const pool = getPool()
    await pool.query(
      `INSERT INTO goal_programs (id, organization_id, property_id, name, status, created_by)
       VALUES ($1, $2, $3, 'Theirs', 'active', 'test')`,
      [randomUUID(), ORG_B, PROPERTY_B],
    )
    expect(
      (await settings({ portalId: PORTAL, skipPrivateRating: true }, manager))
        .skipPrivateRating,
    ).toBe(true)
  })

  it('shows the wider-goal refusal for the last rating collector', async () => {
    const { settings } = world()
    await seedPortal({ state: 'published' })
    await getPool().query(
      `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, 'Desk', $4, $4)`,
      [GROUP, ORG_A, PROPERTY, CLOCK],
    )
    await getPool().query(
      `INSERT INTO portal_group_memberships
         (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, 'test')`,
      [ORG_A, PROPERTY, PORTAL, GROUP, new Date('2026-09-01T00:00:00.000Z')],
    )
    await seedGoal({ kind: 'portal_group' })

    await expect(
      settings({ portalId: PORTAL, skipPrivateRating: true }, manager),
    ).rejects.toMatchObject({
      code: 'running_rating_goal',
      message:
        'This is the last portal collecting ratings for a running goal. End the goal first.',
    })
  })
})

describe.sequential('personal Portal ordinary edits', () => {
  const personal = {
    kind: 'personal' as const,
    publicName: 'Harbor',
    name: 'Polly Smith',
  }

  it.each([
    ['rename', 'personal_portal_rename_locked'],
    ['change the address of', 'personal_portal_rename_locked'],
    ['archive', 'personal_portal_archive_locked'],
  ] as const)(
    'refuses to %s a personal Portal without changing ownership or publication',
    async (action, code) => {
      const { settings, slug, archive, writes } = world()
      await seedPortal(personal)
      const before = await footprint()
      const admin = asRole('AccountAdmin')
      const attempt =
        action === 'rename'
          ? settings({ portalId: PORTAL, name: 'Another person' }, admin)
          : action === 'archive'
            ? archive({ portalId: PORTAL }, admin)
            : slug({ portalId: PORTAL, slug: 'polly-smith' }, admin)

      await expect(attempt).rejects.toMatchObject({ code })

      expect(writes()).toBe(0)
      expect(await footprint()).toEqual(before)
    },
  )

  it('refuses Restore of an archived personal Portal', async () => {
    const { restore } = world()
    await seedPortal({ ...personal, state: 'archived' })
    await expect(restore({ portalId: PORTAL }, manager)).rejects.toMatchObject({
      code: 'personal_portal_restore_locked',
    })
    expect((await portalRow()).publication_state).toBe('archived')
  })

  it('keeps the manager name out of the first publication snapshot', async () => {
    const { publish } = world()
    await seedPortal({ ...personal, slug: 'portal-12345678' })

    await publish({ portalId: PORTAL }, manager)

    const [snapshot] = await snapshotsOf()
    expect(JSON.stringify(snapshot)).not.toMatch(/Polly|Smith/i)
    expect(JSON.stringify(snapshot)).toContain('Harbor')
    const published = await createPortalPublicationRepository(
      getDb(),
    ).findActiveForPortal(ORG_A, PORTAL as never)
    const portal = await createPortalRepository(getDb()).findById(ORG_A, PORTAL as never)
    await expectPersonalPortalNameStaysPrivate(portal!, published!)
  })
})

describe.sequential('archivePersonalPortal', () => {
  const personal = { kind: 'personal' as const, publicName: 'Harbor' }

  it('archives for an authorized manager departure outside current Property grants', async () => {
    const h = world({ accessible: [] })
    await seedPortal(personal)
    const ctx = {
      ...manager,
      effectivePermissions: new Set(['identity.leave_org'] as const),
    }

    await expect(h.archivePerson({ portalId: PORTAL }, ctx)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect((await portalRow()).publication_state).toBe('draft')
    expect(
      (await h.archiveForDeparture({ portalId: PORTAL }, ctx)).publicationState,
    ).toBe('archived')
    expect((await portalRow()).publication_state).toBe('archived')
  })

  it('lets a PropertyManager remove a personal Portal and repeats safely', async () => {
    const { archivePerson } = world()
    await seedPortal(personal)
    expect((await archivePerson({ portalId: PORTAL }, manager)).publicationState).toBe(
      'archived',
    )
    expect((await archivePerson({ portalId: PORTAL }, manager)).publicationState).toBe(
      'archived',
    )
    expect(await factsOf('portal.archived')).toHaveLength(1)
  })

  it('refuses an ordinary place Portal', async () => {
    const { archivePerson } = world()
    await seedPortal()
    await expect(archivePerson({ portalId: PORTAL }, manager)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect((await portalRow()).publication_state).toBe('draft')
  })

  it('does not reach a personal Portal of another organization', async () => {
    const { archivePerson } = world()
    await seedPortal({ ...personal, id: PORTAL_B, org: ORG_B, property: PROPERTY_B })
    await expect(
      archivePerson({ portalId: PORTAL_B }, asRole('AccountAdmin')),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
    expect((await portalRow(PORTAL_B)).publication_state).toBe('draft')
  })
})
