import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import {
  portalPublicationActivations,
  portalPublicationSnapshots,
} from '#/shared/db/schema/portal-publication.schema'
import {
  bulgarianPrimaryConfiguration,
  immersiveConfiguration,
  immersiveSnapshot,
  IMMERSIVE_FIXTURE_AT,
} from '../../application/__fixtures__/immersive-snapshot'
import type {
  ImmersivePortalPublicationConfiguration,
  PortalPublicationSnapshot,
} from '../../domain/portal-publication-snapshot'
import { snapshotMirrorColumns } from '../mappers/portal-publication-snapshot.mapper'
import { createPortalPublicationRepository } from './portal-publication.repository'

const ORG = organizationId('org-portal-immersive-000000000000001')
const OTHER_ORG = organizationId('org-portal-immersive-000000000000002')
const PROPERTY = propertyId('f7d00000-0000-4000-8000-000000000001')
const PORTAL = portalId('f7e00000-0000-4000-8000-000000000001')
const NOW = IMMERSIVE_FIXTURE_AT
const TOKEN_DIGEST = {
  tokenIdentifier: 'immersivekey001',
  tokenHash: 'd7'.repeat(32),
  tokenKeyVersion: 1,
} as const
const SNAPSHOT_ID = 'f7000000-0000-4000-8000-000000000001'
const ACTIVATION_ID = 'f7100000-0000-4000-8000-000000000001'

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_tokens',
    'portal_links',
    'portal_link_categories',
    'portals',
    'properties',
  ],
})

/** The configuration scoped to this suite's Portal, as a v3 writer would store it. */
function scopedConfiguration(base: ImmersivePortalPublicationConfiguration) {
  return { ...base, portal: { id: PORTAL, slug: 'harbor' } }
}

function scopedSnapshot(
  configuration: ImmersivePortalPublicationConfiguration,
): PortalPublicationSnapshot {
  return immersiveSnapshot(configuration, {
    id: SNAPSHOT_ID,
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    version: 1,
  })
}

/** Inserts the row the v3 writer will one day insert, mirror columns included. */
async function insertActive(
  snapshot: PortalPublicationSnapshot,
  mirror: Partial<ReturnType<typeof snapshotMirrorColumns>> = {},
) {
  const { configuration } = snapshot
  await getDb()
    .insert(portalPublicationSnapshots)
    .values({
      id: snapshot.id,
      organizationId: snapshot.organizationId,
      propertyId: snapshot.propertyId,
      portalId: snapshot.portalId,
      version: snapshot.version,
      configurationDigest: snapshot.configurationDigest,
      configuration,
      guestLocale: configuration.guestLocale,
      languagePackVersion: configuration.languagePackVersion,
      ...snapshotMirrorColumns(configuration),
      ...mirror,
      privateFeedbackThreshold: configuration.reviewGateway.privateFeedbackThreshold,
      destinationUri: snapshot.destinationUri,
      destinationRetrievedAt: snapshot.destinationRetrievedAt,
      destinationSourceEpoch: snapshot.destinationSourceEpoch,
      destinationProfileVersion: snapshot.destinationProfileVersion,
      createdBy: snapshot.createdBy,
      createdAt: snapshot.createdAt,
    })
  await getDb().insert(portalPublicationActivations).values({
    id: ACTIVATION_ID,
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    snapshotId: snapshot.id,
    activationSequence: 1,
    kind: 'publish',
    activatedBy: 'manager-immersive-1',
    activatedAt: snapshot.createdAt,
  })
}

beforeEach(async () => {
  await getPool().query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Immersive Property', 'immersive-property', 'UTC', $3, $3)`,
    [PROPERTY, ORG, NOW],
  )
  await getPool().query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        theme, private_feedback_threshold, publication_state, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $4, 'Working name', 'harbor',
             '{"primaryColor":"#123456"}'::jsonb, 3, 'published', $5, $5)`,
    [PORTAL, ORG, PROPERTY, PROPERTY, NOW],
  )
  await getPool().query(
    `INSERT INTO portal_tokens
       (id, organization_id, property_id, portal_id, token_identifier,
        token_hash, token_key_version, version, status, issued_at)
     VALUES ('f7f00000-0000-4000-8000-000000000001', $1, $2, $3, $4, $5, $6,
             1, 'active', $7)`,
    [
      ORG,
      PROPERTY,
      PORTAL,
      TOKEN_DIGEST.tokenIdentifier,
      TOKEN_DIGEST.tokenHash,
      TOKEN_DIGEST.tokenKeyVersion,
      NOW,
    ],
  )
})

const resolveNow = () =>
  createPortalPublicationRepository(getDb()).resolveActiveByTokenDigest(
    TOKEN_DIGEST,
    new Date(NOW.getTime() + 1_000),
  )

describe.sequential('schema version 3 publication (real PostgreSQL)', () => {
  it('reads a stored v3 snapshot back exactly, through the jsonb round trip', async () => {
    const snapshot = scopedSnapshot(scopedConfiguration(bulgarianPrimaryConfiguration()))
    await insertActive(snapshot)

    const resolved = await resolveNow()

    expect(resolved?.snapshot.configuration).toEqual(snapshot.configuration)
    expect(resolved?.snapshot.configurationDigest).toBe(snapshot.configurationDigest)
    expect(resolved?.snapshot.configuration.schemaVersion).toBe(3)
  })

  it('writes the mirror columns of a Bulgarian-primary v3 snapshot from the configuration', async () => {
    await insertActive(
      scopedSnapshot(scopedConfiguration(bulgarianPrimaryConfiguration())),
    )

    const { rows } = await getPool().query(
      `SELECT guest_locale, language_pack_version, locale_set, language_pack_versions,
              brand_profile_version
         FROM portal_publication_snapshots WHERE id = $1`,
      [SNAPSHOT_ID],
    )

    expect(rows[0]).toMatchObject({
      guest_locale: 'bg',
      language_pack_version: 'guest-ui-bg-v2',
      locale_set: ['bg', 'en'],
      brand_profile_version: 3,
    })
    expect(rows[0].language_pack_versions).toEqual({
      en: 'guest-ui-en-v2',
      bg: 'guest-ui-bg-v2',
    })
  })

  it('serves no row whose mirror columns disagree with its configuration', async () => {
    const snapshot = scopedSnapshot(scopedConfiguration(immersiveConfiguration()))
    await insertActive(snapshot, {
      localeSet: ['en'],
      languagePackVersions: { en: 'guest-ui-en-v2' },
    })

    await expect(resolveNow()).resolves.toBeNull()
  })

  const germanConfiguration = (pack: string) =>
    scopedConfiguration(
      immersiveConfiguration({
        guestLocale: 'de',
        languagePackVersion: pack,
        localeSet: ['de'],
        languagePackVersions: { de: pack },
        localizedContent: { de: immersiveConfiguration().localizedContent.en },
        links: [],
      }),
    )

  it('serves a German row, whose generation 2 pack is registered', async () => {
    await insertActive(scopedSnapshot(germanConfiguration('guest-ui-de-v2')))

    await expect(resolveNow()).resolves.not.toBeNull()
  })

  it('is broad in the database and strict in the application: an unregistered de pack passes the CHECKs but is never served', async () => {
    // The insert succeeding is the point: the six-locale CHECKs from slice 2
    // accept any generation of any catalogue locale, and only the verifier,
    // which knows the pack registry, refuses a pack that is not in it.
    await insertActive(scopedSnapshot(germanConfiguration('guest-ui-de-v3')))

    await expect(resolveNow()).resolves.toBeNull()
  })

  it('never serves a v3 row that carries generation 1 packs', async () => {
    const generationOne = scopedConfiguration(
      immersiveConfiguration({
        languagePackVersion: 'guest-ui-en-v1',
        languagePackVersions: { en: 'guest-ui-en-v1', bg: 'guest-ui-bg-v1' },
      }),
    )
    await insertActive(scopedSnapshot(generationOne))

    await expect(resolveNow()).resolves.toBeNull()
  })
})
