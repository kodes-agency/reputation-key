import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import {
  portalPublicationActivations,
  portalPublicationSnapshots,
} from '#/shared/db/schema/portal.schema'
import {
  guestResponseExperienceSnapshots,
  guestResponses,
} from '#/shared/db/schema/guest.schema'
import { buildPortalPublicationSnapshot } from '../../application/portal-publication-snapshot'
import { createPortalPublicationRepository } from './portal-publication.repository'

const ORG = organizationId('org-portal-publication-0000000000001')
const OTHER_ORG = organizationId('org-portal-publication-0000000000002')
const PROPERTY = propertyId('f4d00000-0000-4000-8000-000000000001')
const PORTAL = portalId('f4e00000-0000-4000-8000-000000000001')
const RESPONSE = 'f5200000-0000-4000-8000-000000000001'
const NOW = new Date('2026-08-26T13:00:00.000Z')
const TOKEN_DIGEST = {
  tokenIdentifier: 'publicationkey01',
  tokenHash: 'c'.repeat(64),
  tokenKeyVersion: 1,
} as const

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'guest_response_experience_snapshots',
    'guest_responses',
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_tokens',
    'portal_links',
    'portal_link_categories',
    'portals',
    'properties',
  ],
})

function snapshot(version: number, name: string, id: string) {
  return buildPortalPublicationSnapshot({
    id,
    portalId: PORTAL,
    organizationId: ORG,
    propertyId: PROPERTY,
    version,
    source: {
      portal: {
        id: PORTAL,
        name,
        slug: 'lobby',
        description: null,
        heroImageUrl: null,
        theme: { primaryColor: '#123456' },
        organizationName: `Test Org t-${String(ORG).replace(/-/gu, '')}`,
      },
      categories: [],
      links: [],
      privateFeedbackThreshold: 3,
      organizationId: ORG,
      propertyId: PROPERTY,
    },
    destination: {
      state: 'verified',
      uri: 'https://search.google.com/local/writereview?placeid=publication-test',
      retrievedAt: NOW,
      sourceEpoch: 2,
      profileVersion: 3,
    },
    createdBy: 'manager-publication-1',
    createdAt: new Date(NOW.getTime() + version),
  })
}

function snapshotRow(value: ReturnType<typeof snapshot>) {
  return {
    id: value.id,
    organizationId: value.organizationId,
    propertyId: value.propertyId,
    portalId: value.portalId,
    version: value.version,
    configurationDigest: value.configurationDigest,
    configuration: value.configuration,
    guestLocale: value.configuration.guestLocale,
    languagePackVersion: value.configuration.languagePackVersion,
    privateFeedbackThreshold: value.configuration.reviewGateway.privateFeedbackThreshold,
    destinationUri: value.destinationUri,
    destinationRetrievedAt: value.destinationRetrievedAt,
    destinationSourceEpoch: value.destinationSourceEpoch,
    destinationProfileVersion: value.destinationProfileVersion,
    createdBy: value.createdBy,
    createdAt: value.createdAt,
  }
}

beforeEach(async () => {
  await getPool().query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Publication Property', 'publication-property', 'UTC', $3, $3)`,
    [PROPERTY, ORG, NOW],
  )
  await getPool().query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        theme, private_feedback_threshold, publication_state, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $4, 'Mutable working name', 'lobby',
             '{"primaryColor":"#123456"}'::jsonb, 3, 'published', $5, $5)`,
    [PORTAL, ORG, PROPERTY, PROPERTY, NOW],
  )
  await getPool().query(
    `INSERT INTO portal_tokens
       (id, organization_id, property_id, portal_id, token_identifier,
        token_hash, token_key_version, version, status, issued_at)
     VALUES ('f4f00000-0000-4000-8000-000000000001', $1, $2, $3, $4, $5, $6,
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

afterEach(async () => {
  await getPool().query(`DELETE FROM guest_responses WHERE organization_id = $1`, [ORG])
})

describe.sequential('Portal publication repository (real PostgreSQL)', () => {
  it('resolves a token to one immutable active version despite working-copy edits', async () => {
    const published = snapshot(
      1,
      'Published immutable name',
      'f5000000-0000-4000-8000-000000000001',
    )
    await getDb().insert(portalPublicationSnapshots).values(snapshotRow(published))
    await getDb().insert(portalPublicationActivations).values({
      id: 'f5100000-0000-4000-8000-000000000001',
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      snapshotId: published.id,
      activationSequence: 1,
      kind: 'publish',
      activatedBy: 'manager-publication-1',
      activatedAt: published.createdAt,
    })

    await getPool().query(
      `UPDATE portals SET name = 'Later working-copy edit', updated_at = $1
       WHERE organization_id = $2 AND id = $3`,
      [new Date(NOW.getTime() + 10_000), ORG, PORTAL],
    )

    const repo = createPortalPublicationRepository(getDb())
    await expect(repo.resolveActiveByTokenDigest(TOKEN_DIGEST, NOW)).resolves.toBeNull()
    const resolved = await repo.resolveActiveByTokenDigest(
      TOKEN_DIGEST,
      new Date(NOW.getTime() + 100),
    )
    expect(resolved?.snapshot.version).toBe(1)
    expect(resolved?.snapshot.configuration.portal.name).toBe('Published immutable name')
    expect(resolved?.snapshot.configurationDigest).toBe(published.configurationDigest)
  })

  it('rollback appends a route to an older snapshot and revocation still wins', async () => {
    const first = snapshot(
      1,
      'First published name',
      'f5000000-0000-4000-8000-000000000001',
    )
    const second = snapshot(
      2,
      'Second published name',
      'f5000000-0000-4000-8000-000000000002',
    )
    await getDb()
      .insert(portalPublicationSnapshots)
      .values([snapshotRow(first), snapshotRow(second)])
    await getDb()
      .insert(portalPublicationActivations)
      .values([
        {
          id: 'f5100000-0000-4000-8000-000000000001',
          organizationId: ORG,
          propertyId: PROPERTY,
          portalId: PORTAL,
          snapshotId: first.id,
          activationSequence: 1,
          kind: 'publish',
          activatedBy: 'manager-publication-1',
          activatedAt: first.createdAt,
          deactivatedAt: second.createdAt,
          deactivationReason: 'replaced',
        },
        {
          id: 'f5100000-0000-4000-8000-000000000002',
          organizationId: ORG,
          propertyId: PROPERTY,
          portalId: PORTAL,
          snapshotId: second.id,
          activationSequence: 2,
          kind: 'publish',
          activatedBy: 'manager-publication-1',
          activatedAt: second.createdAt,
          deactivatedAt: new Date(NOW.getTime() + 20_000),
          deactivationReason: 'replaced',
        },
        {
          id: 'f5100000-0000-4000-8000-000000000003',
          organizationId: ORG,
          propertyId: PROPERTY,
          portalId: PORTAL,
          snapshotId: first.id,
          activationSequence: 3,
          kind: 'rollback',
          activatedBy: 'manager-publication-2',
          activatedAt: new Date(NOW.getTime() + 20_000),
        },
      ])
    const repo = createPortalPublicationRepository(getDb())

    await expect(
      repo.resolveActiveByTokenDigest(TOKEN_DIGEST, new Date(NOW.getTime() + 30_000)),
    ).resolves.toMatchObject({ snapshot: { id: first.id, version: 1 } })

    await getPool().query(
      `UPDATE portal_tokens SET status = 'revoked', revoked_at = $1, retired_at = $1,
               revoked_by = 'manager-publication-2', revoked_reason = 'address_replaced'
       WHERE organization_id = $2 AND portal_id = $3`,
      [new Date(NOW.getTime() + 31_000), ORG, PORTAL],
    )
    await expect(
      repo.resolveActiveByTokenDigest(TOKEN_DIGEST, new Date(NOW.getTime() + 32_000)),
    ).resolves.toBeNull()
  })

  it('lists publication and rollback activity only inside the exact property scope', async () => {
    const first = snapshot(
      1,
      'First published name',
      'f5000000-0000-4000-8000-000000000001',
    )
    const second = snapshot(
      2,
      'Second published name',
      'f5000000-0000-4000-8000-000000000002',
    )
    await getDb()
      .insert(portalPublicationSnapshots)
      .values([snapshotRow(first), snapshotRow(second)])
    await getDb()
      .insert(portalPublicationActivations)
      .values([
        {
          id: 'f5100000-0000-4000-8000-000000000001',
          organizationId: ORG,
          propertyId: PROPERTY,
          portalId: PORTAL,
          snapshotId: first.id,
          activationSequence: 1,
          kind: 'publish',
          activatedBy: 'manager-publication-1',
          activatedAt: first.createdAt,
          deactivatedAt: second.createdAt,
          deactivationReason: 'replaced',
        },
        {
          id: 'f5100000-0000-4000-8000-000000000002',
          organizationId: ORG,
          propertyId: PROPERTY,
          portalId: PORTAL,
          snapshotId: second.id,
          activationSequence: 2,
          kind: 'publish',
          activatedBy: 'manager-publication-1',
          activatedAt: second.createdAt,
          deactivatedAt: new Date(NOW.getTime() + 20_000),
          deactivationReason: 'replaced',
        },
        {
          id: 'f5100000-0000-4000-8000-000000000003',
          organizationId: ORG,
          propertyId: PROPERTY,
          portalId: PORTAL,
          snapshotId: first.id,
          activationSequence: 3,
          kind: 'rollback',
          activatedBy: 'manager-publication-2',
          activatedAt: new Date(NOW.getTime() + 20_000),
        },
      ])

    const repo = createPortalPublicationRepository(getDb())
    const history = await repo.listActivationHistory(ORG, PROPERTY, PORTAL)

    expect(
      history.map(({ activation, snapshot: publication }) => ({
        sequence: activation.activationSequence,
        kind: activation.kind,
        version: publication.version,
        current: activation.deactivatedAt === null,
      })),
    ).toEqual([
      { sequence: 3, kind: 'rollback', version: 1, current: true },
      { sequence: 2, kind: 'publish', version: 2, current: false },
      { sequence: 1, kind: 'publish', version: 1, current: false },
    ])
    await expect(
      repo.listActivationHistory(
        ORG,
        propertyId('f4d00000-0000-4000-8000-000000000099'),
        PORTAL,
      ),
    ).resolves.toEqual([])
    await expect(
      repo.listActivationHistory(OTHER_ORG, PROPERTY, PORTAL),
    ).resolves.toEqual([])
  })

  it('fails closed if durable snapshot content no longer matches its digest', async () => {
    const published = snapshot(
      1,
      'Published immutable name',
      'f5000000-0000-4000-8000-000000000001',
    )
    await getDb()
      .insert(portalPublicationSnapshots)
      .values({
        ...snapshotRow(published),
        configuration: {
          ...published.configuration,
          portal: {
            ...published.configuration.portal,
            name: 'Mismatched stored content',
          },
        },
      })
    await getDb().insert(portalPublicationActivations).values({
      id: 'f5100000-0000-4000-8000-000000000001',
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      snapshotId: published.id,
      activationSequence: 1,
      kind: 'publish',
      activatedBy: 'manager-publication-1',
      activatedAt: published.createdAt,
    })
    await expect(
      createPortalPublicationRepository(getDb()).resolveActiveByTokenDigest(
        TOKEN_DIGEST,
        new Date(NOW.getTime() + 100),
      ),
    ).resolves.toBeNull()
  })

  it('prevents snapshot rewrites and permits only one-time activation closure', async () => {
    const published = snapshot(
      1,
      'Published immutable name',
      'f5000000-0000-4000-8000-000000000001',
    )
    await getDb().insert(portalPublicationSnapshots).values(snapshotRow(published))
    await getDb().insert(portalPublicationActivations).values({
      id: 'f5100000-0000-4000-8000-000000000001',
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      snapshotId: published.id,
      activationSequence: 1,
      kind: 'publish',
      activatedBy: 'manager-publication-1',
      activatedAt: published.createdAt,
    })

    await expect(
      getPool().query(
        `UPDATE portal_publication_snapshots
         SET configuration = jsonb_set(configuration, '{portal,name}', '"rewritten"')
         WHERE id = $1`,
        [published.id],
      ),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(
      getPool().query(
        `UPDATE portal_publication_activations SET kind = 'rollback' WHERE id = $1`,
        ['f5100000-0000-4000-8000-000000000001'],
      ),
    ).rejects.toMatchObject({ code: '55000' })

    const closedAt = new Date(NOW.getTime() + 1_000)
    await expect(
      getPool().query(
        `UPDATE portal_publication_activations
         SET deactivated_at = $1, deactivation_reason = 'disabled'
         WHERE id = $2`,
        [closedAt, 'f5100000-0000-4000-8000-000000000001'],
      ),
    ).resolves.toMatchObject({ rowCount: 1 })
    await expect(
      getPool().query(
        `UPDATE portal_publication_activations
         SET deactivated_at = $1 WHERE id = $2`,
        [new Date(closedAt.getTime() + 1_000), 'f5100000-0000-4000-8000-000000000001'],
      ),
    ).rejects.toMatchObject({ code: '55000' })
  })

  it('rejects guest evidence that names the right snapshot with the wrong version', async () => {
    const published = snapshot(
      1,
      'Published immutable name',
      'f5000000-0000-4000-8000-000000000001',
    )
    await getDb().insert(portalPublicationSnapshots).values(snapshotRow(published))
    await getDb()
      .insert(guestResponses)
      .values({
        id: RESPONSE,
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        retentionDeadline: new Date(NOW.getTime() + 86_400_000),
      })

    await expect(
      getDb().insert(guestResponseExperienceSnapshots).values({
        responseId: RESPONSE,
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        publicationState: 'published',
        publicationSnapshotId: published.id,
        publicationVersion: 2,
        publicationDigest: published.configurationDigest,
        configurationDigest: published.configurationDigest,
        guestLocale: published.configuration.guestLocale,
        languagePackVersion: published.configuration.languagePackVersion,
        privateFeedbackThreshold:
          published.configuration.reviewGateway.privateFeedbackThreshold,
        capturedAt: NOW,
      }),
    ).rejects.toMatchObject({
      cause: {
        code: '23503',
        constraint: 'guest_response_experience_snapshots_publication_scope_fk',
      },
    })
  })
})
