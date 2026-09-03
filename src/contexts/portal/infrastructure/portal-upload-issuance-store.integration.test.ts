import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createPortalUploadIssuanceStore } from './portal-upload-issuance-store'
import { createPortalHeroUploadIssuance } from '../domain/upload-issuance'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { portalHeroImageProcessingRequested } from '../domain/events'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'

const ORG_A = organizationId('org-upload-0000-0000-0000-000000000001')
const ORG_B = organizationId('org-upload-0000-0000-0000-000000000002')
const PROPERTY_A = propertyId('7a000000-0000-4000-8000-000000000001')
const PORTAL_A = portalId('7b000000-0000-4000-8000-000000000001')
const UPLOAD_A = '7c000000-0000-4000-8000-000000000001'
const UPLOAD_B = '7c000000-0000-4000-8000-000000000002'
const UPLOAD_C = '7c000000-0000-4000-8000-000000000003'
const ISSUED_AT = new Date('2026-08-26T12:00:00.000Z')
const STAGED_AT = new Date('2026-08-26T12:01:00.000Z')
const PUBLISHED_AT = new Date('2026-08-26T12:02:00.000Z')
const FUTURE_REVISION = new Date('2026-08-26T12:03:00.000Z')
const CLEANUP_AT = new Date('2026-08-26T12:16:00.000Z')
const SOURCE_ETAG = '"d41d8cd98f00b204e9800998ecf8427e"'

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['outbox_events', 'portal_upload_issuances', 'portals', 'properties'],
})

const makeIssuance = (id: string) => {
  const issuance = createPortalHeroUploadIssuance({
    id,
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    portalId: PORTAL_A,
    contentType: 'image/png',
    declaredSizeBytes: 1024,
    now: ISSUED_AT,
  })
  if (!issuance) throw new Error('test issuance must be valid')
  return issuance
}

const scope = (issuanceId: string) => ({
  organizationId: ORG_A,
  propertyId: PROPERTY_A,
  portalId: PORTAL_A,
  issuanceId,
})

const observed = {
  contentType: 'image/png',
  sizeBytes: 1024,
  sourceETag: SOURCE_ETAG,
} as const

const processingRequest = (issuanceId: string, organization = ORG_A) =>
  portalHeroImageProcessingRequested({
    uploadId: issuanceId,
    organizationId: organization,
    propertyId: PROPERTY_A,
    portalId: PORTAL_A,
    sourceETag: SOURCE_ETAG,
    occurredAt: STAGED_AT,
  })

beforeEach(async () => {
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Upload Property', 'upload-property', 'UTC', $3, $3)`,
    [PROPERTY_A, ORG_A, ISSUED_AT],
  )
  await getPool().query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        hero_image_url, created_at, updated_at)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Reception', 'reception',
             'https://cdn.example.com/previous.webp', $4, $4)`,
    [PORTAL_A, ORG_A, PROPERTY_A, ISSUED_AT],
  )
})

describe.sequential('Portal upload issuance store (real PostgreSQL)', () => {
  it('database checks reject arbitrary source keys and foreign Portal scope', async () => {
    await expect(
      getPool().query(
        `INSERT INTO portal_upload_issuances
           (id, organization_id, property_id, portal_id, purpose, object_key,
            content_type, declared_size_bytes, max_size_bytes, state,
            issued_at, expires_at)
         VALUES ($1, $2, $3, $4, 'hero_image', 'caller/chosen/key.png',
                 'image/png', 1024, 10485760, 'issued', $5, $6)`,
        [
          UPLOAD_A,
          ORG_A,
          PROPERTY_A,
          PORTAL_A,
          ISSUED_AT,
          new Date('2026-08-26T12:15:00.000Z'),
        ],
      ),
    ).rejects.toMatchObject({ constraint: 'portal_upload_issuances_source_key_valid' })

    await expect(
      getPool().query(
        `INSERT INTO portal_upload_issuances
           (id, organization_id, property_id, portal_id, purpose, object_key,
            content_type, declared_size_bytes, max_size_bytes, state,
            issued_at, expires_at)
         VALUES ($1, $2, $3, $4, 'hero_image', $5,
                 'image/png', 1024, 10485760, 'issued', $6, $7)`,
        [
          UPLOAD_B,
          ORG_B,
          PROPERTY_A,
          PORTAL_A,
          `private/portal-uploads/${UPLOAD_B}/source.png`,
          ISSUED_AT,
          new Date('2026-08-26T12:15:00.000Z'),
        ],
      ),
    ).rejects.toMatchObject({
      constraint: 'portal_upload_issuances_portal_tenant_fk',
    })

    await expect(
      getPool().query(
        `INSERT INTO portal_upload_issuances
           (id, organization_id, property_id, portal_id, purpose, object_key,
            content_type, declared_size_bytes, max_size_bytes, state,
            issued_at, expires_at)
         VALUES ($1, $2, $3, $4, 'guest_media', $5,
                 'image/png', 1024, 10485760, 'issued', $6, $7)`,
        [
          UPLOAD_C,
          ORG_A,
          PROPERTY_A,
          PORTAL_A,
          `private/portal-uploads/${UPLOAD_C}/source.png`,
          ISSUED_AT,
          new Date('2026-08-26T12:15:00.000Z'),
        ],
      ),
    ).rejects.toMatchObject({ constraint: 'portal_upload_issuances_purpose_valid' })
  })

  it('scopes finalization, atomically consumes once, and keeps the previous image', async () => {
    const store = createPortalUploadIssuanceStore(getDb())
    await store.create(makeIssuance(UPLOAD_A))

    await expect(
      store.findScoped({ ...scope(UPLOAD_A), organizationId: ORG_B }),
    ).resolves.toBeNull()
    await expect(
      store.stage(
        { ...scope(UPLOAD_A), organizationId: ORG_B },
        observed,
        processingRequest(UPLOAD_A, ORG_B),
        STAGED_AT,
      ),
    ).resolves.toEqual({ outcome: 'not_found' })

    await expect(
      store.stage(scope(UPLOAD_A), observed, processingRequest(UPLOAD_A), STAGED_AT),
    ).resolves.toEqual({
      outcome: 'staged',
      heroImageUrl: 'https://cdn.example.com/previous.webp',
    })
    await expect(
      store.stage(scope(UPLOAD_A), observed, processingRequest(UPLOAD_A), STAGED_AT),
    ).resolves.toEqual({ outcome: 'not_issued' })

    const row = await getPool().query(
      `SELECT state, consumed_at, hero_image_url
       FROM portal_upload_issuances WHERE id = $1`,
      [UPLOAD_A],
    )
    expect(row.rows[0]).toEqual({
      state: 'consumed',
      consumed_at: STAGED_AT,
      hero_image_url: null,
    })
    const outbox = await getPool().query(
      `SELECT event_type, payload
       FROM outbox_events
       WHERE organization_id = $1 AND source_aggregate_id = $2`,
      [ORG_A, UPLOAD_A],
    )
    expect(outbox.rows).toEqual([
      {
        event_type: 'portal.hero_image.processing_requested',
        payload: expect.objectContaining({
          uploadId: UPLOAD_A,
          sourceETag: SOURCE_ETAG,
        }),
      },
    ])
  })

  it('allows only one concurrent replay to consume an issuance', async () => {
    const store = createPortalUploadIssuanceStore(getDb())
    await store.create(makeIssuance(UPLOAD_A))

    const results = await Promise.all([
      store.stage(scope(UPLOAD_A), observed, processingRequest(UPLOAD_A), STAGED_AT),
      store.stage(scope(UPLOAD_A), observed, processingRequest(UPLOAD_A), STAGED_AT),
    ])

    expect(results.map((result) => result.outcome).sort()).toEqual([
      'not_issued',
      'staged',
    ])
  })

  it('rolls back consumption when the durable processing fact cannot be recorded', async () => {
    const store = createPortalUploadIssuanceStore(getDb())
    await store.create(makeIssuance(UPLOAD_A))
    const request = processingRequest(UPLOAD_A)

    // Occupy the event id so the transaction's outbox insert fails. The
    // issuance update must not survive that same transaction.
    await getPool().query(
      `INSERT INTO outbox_events
         (id, event_type, event_version, payload, organization_id, property_id,
          source_context, source_aggregate_id, created_at)
       VALUES ($1, 'test.portal_upload_collision', 1, '{}'::jsonb, $2, $3,
               'test', $4, $5)`,
      [request.eventId, ORG_A, PROPERTY_A, UPLOAD_A, STAGED_AT],
    )

    await expect(
      store.stage(scope(UPLOAD_A), observed, request, STAGED_AT),
    ).rejects.toMatchObject({
      cause: { constraint: 'outbox_events_pkey' },
    })

    const row = await getPool().query(
      `SELECT state, consumed_at
       FROM portal_upload_issuances WHERE id = $1`,
      [UPLOAD_A],
    )
    expect(row.rows[0]).toEqual({ state: 'issued', consumed_at: null })
  })

  it('terminally rejects server-observed MIME or size drift', async () => {
    const store = createPortalUploadIssuanceStore(getDb())
    await store.create(makeIssuance(UPLOAD_A))

    await expect(
      store.stage(
        scope(UPLOAD_A),
        { ...observed, contentType: 'image/jpeg' },
        processingRequest(UPLOAD_A),
        STAGED_AT,
      ),
    ).resolves.toEqual({ outcome: 'metadata_mismatch' })
    await expect(store.findProcessable(scope(UPLOAD_A))).resolves.toBeNull()

    const row = await getPool().query(
      'SELECT state, rejected_at FROM portal_upload_issuances WHERE id = $1',
      [UPLOAD_A],
    )
    expect(row.rows[0]).toEqual({ state: 'rejected', rejected_at: STAGED_AT })
  })

  it('rolls back hero publication and issuance finalization when its completion fact conflicts', async () => {
    const store = createPortalUploadIssuanceStore(getDb())
    await store.create(makeIssuance(UPLOAD_A))
    await store.stage(scope(UPLOAD_A), observed, processingRequest(UPLOAD_A), STAGED_AT)
    await getPool().query(
      `ALTER TABLE outbox_events
       ADD CONSTRAINT test_reject_portal_upload_completion
       CHECK (event_type <> 'portal.hero_image.published')`,
    )

    try {
      await expect(
        store.publishDerivative(
          scope(UPLOAD_A),
          {
            heroKey: `public/portal-heroes/${UPLOAD_A}/hero.webp`,
            thumbnailKey: `public/portal-heroes/${UPLOAD_A}/thumbnail.webp`,
            heroImageUrl: `https://cdn.example.com/${UPLOAD_A}/hero.webp`,
          },
          PUBLISHED_AT,
        ),
      ).rejects.toMatchObject({
        cause: { constraint: 'test_reject_portal_upload_completion' },
      })
    } finally {
      await getPool().query(
        `ALTER TABLE outbox_events
         DROP CONSTRAINT IF EXISTS test_reject_portal_upload_completion`,
      )
    }

    const state = await getPool().query(
      `SELECT p.hero_image_url, p.updated_at, i.state, i.finalized_at
       FROM portals p
       JOIN portal_upload_issuances i ON i.portal_id = p.id
       WHERE p.organization_id = $1 AND p.id = $2 AND i.id = $3`,
      [ORG_A, PORTAL_A, UPLOAD_A],
    )
    expect(state.rows).toEqual([
      {
        hero_image_url: 'https://cdn.example.com/previous.webp',
        updated_at: ISSUED_AT,
        state: 'consumed',
        finalized_at: null,
      },
    ])
  })

  it('prevents a stale worker from replacing the newer upload derivative', async () => {
    // @proof PORTAL_UPLOAD_FOREIGN_KEY#1
    const store = createPortalUploadIssuanceStore(getDb())
    await store.create(makeIssuance(UPLOAD_A))
    await store.create(makeIssuance(UPLOAD_B))
    await store.stage(scope(UPLOAD_A), observed, processingRequest(UPLOAD_A), STAGED_AT)
    await store.stage(scope(UPLOAD_B), observed, processingRequest(UPLOAD_B), STAGED_AT)

    await expect(
      store.publishDerivative(
        scope(UPLOAD_A),
        {
          heroKey: `public/portal-heroes/${UPLOAD_A}/hero.webp`,
          thumbnailKey: `public/portal-heroes/${UPLOAD_A}/thumbnail.webp`,
          heroImageUrl: `https://cdn.example.com/${UPLOAD_A}/hero.webp`,
        },
        PUBLISHED_AT,
      ),
    ).resolves.toEqual({ outcome: 'stale' })
    await getPool().query(
      'UPDATE portals SET updated_at = $1 WHERE id = $2 AND organization_id = $3',
      [FUTURE_REVISION, PORTAL_A, ORG_A],
    )
    await expect(
      store.publishDerivative(
        scope(UPLOAD_B),
        {
          heroKey: `public/portal-heroes/${UPLOAD_B}/hero.webp`,
          thumbnailKey: `public/portal-heroes/${UPLOAD_B}/thumbnail.webp`,
          heroImageUrl: `https://cdn.example.com/${UPLOAD_B}/hero.webp`,
        },
        PUBLISHED_AT,
      ),
    ).resolves.toEqual({
      outcome: 'published',
      heroImageUrl: `https://cdn.example.com/${UPLOAD_B}/hero.webp`,
    })
    await expect(
      store.publishDerivative(
        scope(UPLOAD_B),
        {
          heroKey: `public/portal-heroes/${UPLOAD_B}/hero.webp`,
          thumbnailKey: `public/portal-heroes/${UPLOAD_B}/thumbnail.webp`,
          heroImageUrl: `https://cdn.example.com/${UPLOAD_B}/hero.webp`,
        },
        PUBLISHED_AT,
      ),
    ).resolves.toEqual({ outcome: 'already_finalized' })

    const portal = await getPool().query(
      'SELECT hero_image_url, updated_at FROM portals WHERE id = $1 AND organization_id = $2',
      [PORTAL_A, ORG_A],
    )
    const rows = await getPool().query(
      `SELECT id, state, finalized_at FROM portal_upload_issuances
       WHERE organization_id = $1 ORDER BY id`,
      [ORG_A],
    )
    expect(portal.rows[0].hero_image_url).toBe(
      `https://cdn.example.com/${UPLOAD_B}/hero.webp`,
    )
    expect(portal.rows[0].updated_at).toEqual(new Date(FUTURE_REVISION.getTime() + 1))
    expect(rows.rows).toEqual([
      { id: UPLOAD_A, state: 'superseded', finalized_at: null },
      { id: UPLOAD_B, state: 'finalized', finalized_at: PUBLISHED_AT },
    ])
    const publishedFacts = await getPool().query(
      `SELECT payload
       FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'portal.hero_image.published'`,
      [ORG_A],
    )
    expect(publishedFacts.rows).toEqual([
      {
        payload: expect.objectContaining({
          uploadId: UPLOAD_B,
          occurredAt: PUBLISHED_AT.toISOString(),
          sourceAggregateVersion: new Date(FUTURE_REVISION.getTime() + 1).toISOString(),
        }),
      },
    ])
  })

  it('expires due issuances and records idempotent private-source cleanup', async () => {
    const store = createPortalUploadIssuanceStore(getDb())
    await store.create(makeIssuance(UPLOAD_A))

    await expect(store.listSourceCleanupCandidates(CLEANUP_AT, 100)).resolves.toEqual([
      expect.objectContaining({
        id: UPLOAD_A,
        state: 'expired',
        expiredAt: CLEANUP_AT,
        sourceDeletedAt: null,
        orphanDerivativesDeletedAt: null,
      }),
    ])
    await expect(
      store.markSourceDeleted(scope(UPLOAD_A), 'expired', CLEANUP_AT),
    ).resolves.toBe(true)
    await expect(
      store.markSourceDeleted(scope(UPLOAD_A), 'expired', CLEANUP_AT),
    ).resolves.toBe(false)
    await expect(store.listSourceCleanupCandidates(CLEANUP_AT, 100)).resolves.toEqual([
      expect.objectContaining({
        id: UPLOAD_A,
        sourceDeletedAt: CLEANUP_AT,
        orphanDerivativesDeletedAt: null,
      }),
    ])
    await expect(
      store.markOrphanDerivativesDeleted(scope(UPLOAD_A), 'expired', CLEANUP_AT),
    ).resolves.toBe(true)
    await expect(
      store.markOrphanDerivativesDeleted(scope(UPLOAD_A), 'expired', CLEANUP_AT),
    ).resolves.toBe(false)
    await expect(store.listSourceCleanupCandidates(CLEANUP_AT, 100)).resolves.toEqual([])

    const row = await getPool().query(
      `SELECT state, expired_at, source_deleted_at, orphan_derivatives_deleted_at
       FROM portal_upload_issuances WHERE id = $1`,
      [UPLOAD_A],
    )
    expect(row.rows).toEqual([
      {
        state: 'expired',
        expired_at: CLEANUP_AT,
        source_deleted_at: CLEANUP_AT,
        orphan_derivatives_deleted_at: CLEANUP_AT,
      },
    ])
  })

  it('never exposes an active consumed source to cleanup', async () => {
    const store = createPortalUploadIssuanceStore(getDb())
    await store.create(makeIssuance(UPLOAD_A))
    await store.stage(scope(UPLOAD_A), observed, processingRequest(UPLOAD_A), STAGED_AT)

    await expect(store.listSourceCleanupCandidates(CLEANUP_AT, 100)).resolves.toEqual([])
    await expect(
      store.markSourceDeleted(scope(UPLOAD_A), 'consumed', CLEANUP_AT),
    ).resolves.toBe(false)
  })
})
