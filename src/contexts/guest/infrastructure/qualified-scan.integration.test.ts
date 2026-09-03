import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import {
  organizationId,
  portalAccessArtifactId,
  portalGroupId,
  portalId,
  propertyId,
  qualifiedScanId,
} from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { guestQualifiedScanRecorded, guestQualifiedScanRetracted } from '../domain/events'
import { createPortalGroupRepository } from '#/contexts/portal/infrastructure/repositories/portal-group.repository'
import { createPortalAccessArtifactRepository } from '#/contexts/portal/infrastructure/repositories/portal-access-artifact.repository'
import { createAtomicGuestObservationStore } from './guest-observation-store'
import { recordMetric } from '#/contexts/metric/application/use-cases/record-metric'
import { retractMetric } from '#/contexts/metric/application/use-cases/retract-metric'
import { METRIC_VERSION_IDS } from '#/contexts/metric/domain/metric-registry'
import { onQualifiedScanRecordedDurably } from '#/contexts/metric/infrastructure/event-handlers/on-qualified-scan-recorded'
import { onQualifiedScanRetractedDurably } from '#/contexts/metric/infrastructure/event-handlers/on-qualified-scan-retracted'
import { createAtomicMetricCommandStore } from '#/contexts/metric/infrastructure/metric-command-store'
import { createMetricRegistryRepository } from '#/contexts/metric/infrastructure/repositories/metric-registry.repository'
import { createMetricRepository } from '#/contexts/metric/infrastructure/repositories/metric.repository'
import { metricReadingId } from '#/shared/domain/ids'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { createMockLogger } from '#/shared/testing/mock-logger'

const ORG = organizationId('org-qualified-scan-integration')
const OTHER_ORG = organizationId('org-qualified-scan-other')
const PROPERTY = propertyId('73000000-0000-4000-8000-000000000001')
const PORTAL = portalId('73000000-0000-4000-8000-000000000002')
const TOKEN = '73000000-0000-4000-8000-000000000003'
const TOKEN_DIGEST = {
  tokenIdentifier: 'qual-scan-token',
  tokenHash: 'a'.repeat(64),
  tokenKeyVersion: 1,
} as const
const ARTIFACT = portalAccessArtifactId('73000000-0000-4000-8000-000000000004')
const SNAPSHOT = '73000000-0000-4000-8000-000000000005'
const GROUP_AT_EVENT = portalGroupId('73000000-0000-4000-8000-000000000006')
const GROUP_AFTER_EVENT = portalGroupId('73000000-0000-4000-8000-000000000007')
const SESSION = '73000000-0000-4000-8000-000000000008'
const EVENT_TIME = new Date('2026-08-27T10:00:00.000Z')
const GROUP_MOVE_TIME = new Date('2026-08-27T11:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'guest_qualified_scan_receipts',
    'guest_qualified_scans',
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_group_memberships',
    'portal_access_artifacts',
    'portal_tokens',
    'portal_groups',
    'outbox_events',
    'portals',
    'properties',
  ],
})

async function seedPublishedArtifact(): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Qualified Scan Property', 'qualified-scan-property', 'UTC')`,
    [PROPERTY, ORG],
  )
  await pool.query(
    `INSERT INTO portals (
       id, organization_id, property_id, entity_type, entity_id, name, slug,
       publication_state, created_by, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'property', $5, 'Reception', 'reception', 'published',
       'manager-qualified-scan', $4, $4
     )`,
    [PORTAL, ORG, PROPERTY, EVENT_TIME, PROPERTY],
  )
  await pool.query(
    `INSERT INTO portal_tokens (
       id, organization_id, property_id, portal_id, token_identifier, token_hash,
       token_key_version, version, status, issued_at
     ) VALUES ($1, $2, $3, $4, 'qual-scan-token', $5, 1, 1, 'active', $6)`,
    [TOKEN, ORG, PROPERTY, PORTAL, 'a'.repeat(64), EVENT_TIME],
  )
  await pool.query(
    `INSERT INTO portal_access_artifacts (
       id, organization_id, property_id, portal_id, portal_token_id, channel,
       status, published_at
     ) VALUES ($1, $2, $3, $4, $5, 'qr', 'published', $6)`,
    [ARTIFACT, ORG, PROPERTY, PORTAL, TOKEN, EVENT_TIME],
  )
  await pool.query(
    `INSERT INTO portal_publication_snapshots (
       id, organization_id, property_id, portal_id, version,
       configuration_digest, configuration, guest_locale, language_pack_version,
       private_feedback_threshold, contact_request_enabled, destination_uri,
       destination_retrieved_at, destination_source_epoch,
       destination_profile_version, created_by, created_at
     ) VALUES (
       $1, $2, $3, $4, 1, $5, '{}'::jsonb, 'en', 'guest-ui-en-v1', 3,
       false, 'https://example.test/review', $6, 0, 1,
       'manager-qualified-scan', $6
     )`,
    [SNAPSHOT, ORG, PROPERTY, PORTAL, 'b'.repeat(64), EVENT_TIME],
  )
  await pool.query(
    `INSERT INTO portal_publication_activations (
       id, organization_id, property_id, portal_id, snapshot_id,
       activation_sequence, kind, activated_by, activated_at
     ) VALUES (
       '73000000-0000-4000-8000-000000000009', $1, $2, $3, $4,
       1, 'publish', 'manager-qualified-scan', $5
     )`,
    [ORG, PROPERTY, PORTAL, SNAPSHOT, EVENT_TIME],
  )
  await pool.query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name)
     VALUES ($1, $3, $4, 'Reception before move'),
            ($2, $3, $4, 'Reception after move')`,
    [GROUP_AT_EVENT, GROUP_AFTER_EVENT, ORG, PROPERTY],
  )
  await pool.query(
    `INSERT INTO portal_group_memberships (
       organization_id, property_id, portal_id, portal_group_id,
       effective_from, effective_to, created_by, end_reason
     ) VALUES ($1, $2, $3, $4, $5, $6, 'manager-qualified-scan', 'moved'),
              ($1, $2, $3, $7, $6, NULL, 'manager-qualified-scan', NULL)`,
    [
      ORG,
      PROPERTY,
      PORTAL,
      GROUP_AT_EVENT,
      EVENT_TIME,
      GROUP_MOVE_TIME,
      GROUP_AFTER_EVENT,
    ],
  )
}

async function cleanMetricState(): Promise<void> {
  await getPool().query(
    `DELETE FROM event_consumer_receipts
     WHERE event_id IN (
       SELECT id FROM outbox_events WHERE organization_id = $1
     )`,
    [ORG],
  )
  await getPool().query(
    `DELETE FROM metric_corrections
     WHERE reading_id IN (
       SELECT id FROM metric_readings WHERE organization_id = $1
     )`,
    [ORG],
  )
  await getPool().query(`DELETE FROM metric_quarantine WHERE organization_id = $1`, [ORG])
  await getPool().query(`DELETE FROM metric_readings WHERE organization_id = $1`, [ORG])
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await cleanMetricState()
  await seedPublishedArtifact()
})

afterEach(cleanMetricState)

describe.sequential('Access Artifact backed Qualified Scan (integration)', () => {
  it('verifies the published artifact and preserves event-time group attribution', async () => {
    const repo = createPortalAccessArtifactRepository(
      getDb(),
      createPortalGroupRepository(getDb()),
    )

    await expect(
      repo.resolvePublished({
        accessArtifactId: ARTIFACT,
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        publicationSnapshotId: SNAPSHOT,
        tokenDigest: TOKEN_DIGEST,
        asOf: new Date('2026-08-27T10:30:00.000Z'),
      }),
    ).resolves.toMatchObject({
      accessArtifactId: ARTIFACT,
      portalGroupId: GROUP_AT_EVENT,
      channel: 'qr',
    })

    await expect(
      repo.resolvePublished({
        accessArtifactId: ARTIFACT,
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        publicationSnapshotId: '73000000-0000-4000-8000-000000000099',
        tokenDigest: TOKEN_DIGEST,
        asOf: new Date('2026-08-27T10:30:00.000Z'),
      }),
    ).resolves.toBeNull()

    await expect(
      repo.resolvePublished({
        accessArtifactId: ARTIFACT,
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        publicationSnapshotId: SNAPSHOT,
        tokenDigest: { ...TOKEN_DIGEST, tokenHash: 'c'.repeat(64) },
        asOf: new Date('2026-08-27T10:30:00.000Z'),
      }),
    ).resolves.toBeNull()

    await getPool().query(
      `UPDATE portal_access_artifacts
       SET status = 'revoked', retired_at = $2
       WHERE id = $1`,
      [ARTIFACT, new Date('2026-08-27T10:45:00.000Z')],
    )
    await expect(
      repo.resolvePublished({
        accessArtifactId: ARTIFACT,
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        publicationSnapshotId: SNAPSHOT,
        tokenDigest: TOKEN_DIGEST,
        asOf: new Date('2026-08-27T10:50:00.000Z'),
      }),
    ).resolves.toBeNull()
  })

  it('serializes rolling 24-hour dedupe and applies one replay-safe correction', async () => {
    const events = createCapturingEventBus()
    const store = createAtomicGuestObservationStore(getDb(), events)
    const makeScan = (id: string, occurredAt: Date) => {
      const scanId = qualifiedScanId(id)
      const fact = guestQualifiedScanRecorded({
        qualifiedScanId: scanId,
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        portalGroupId: GROUP_AT_EVENT,
        accessArtifactId: ARTIFACT,
        occurredAt,
      })
      return {
        fact,
        scan: {
          id: scanId,
          organizationId: ORG,
          propertyId: PROPERTY,
          portalId: PORTAL,
          portalGroupId: GROUP_AT_EVENT,
          accessArtifactId: ARTIFACT,
          sourceEventId: fact.eventId,
          occurredAt,
          staffAttribution: null,
        },
      }
    }
    const first = makeScan('73000000-0000-4000-8000-000000000011', EVENT_TIME)
    const concurrent = makeScan('73000000-0000-4000-8000-000000000012', EVENT_TIME)

    await expect(
      Promise.all([
        store.commitQualifiedScan(first.scan, SESSION, first.fact),
        store.commitQualifiedScan(concurrent.scan, SESSION, concurrent.fact),
      ]),
    ).resolves.toEqual(expect.arrayContaining(['applied', 'duplicate']))
    expect(
      await getPool().query(
        `SELECT id, portal_group_id, access_artifact_id
         FROM guest_qualified_scans WHERE organization_id = $1`,
        [ORG],
      ),
    ).toMatchObject({
      rowCount: 1,
      rows: [
        expect.objectContaining({
          portal_group_id: GROUP_AT_EVENT,
          access_artifact_id: ARTIFACT,
        }),
      ],
    })

    const afterWindow = makeScan(
      '73000000-0000-4000-8000-000000000013',
      new Date(EVENT_TIME.getTime() + 24 * 60 * 60 * 1000),
    )
    await expect(
      store.commitQualifiedScan(afterWindow.scan, SESSION, afterWindow.fact),
    ).resolves.toBe('applied')

    const retentionRule = RETENTION_RULES.find(
      (candidate) => candidate.subject === 'guest_qualified_scan_receipts.expired',
    )!
    await expect(
      executeRetentionRule(getDb(), retentionRule, {
        cutoff: new Date(afterWindow.scan.occurredAt.getTime() + 24 * 60 * 60 * 1000 + 1),
        batchSize: 10,
      }),
    ).resolves.toMatchObject({ rowsDeleted: 1 })
    expect(
      await getPool().query(
        `SELECT count(*)::int AS count
         FROM guest_qualified_scans
         WHERE organization_id = $1`,
        [ORG],
      ),
    ).toMatchObject({ rows: [{ count: 2 }] })

    const recorded = events.capturedByTag('guest.qualified_scan.recorded')
    expect(recorded).toHaveLength(2)
    const original = recorded[0]!
    const correction = guestQualifiedScanRetracted({
      qualifiedScanId: original.qualifiedScanId,
      organizationId: original.organizationId,
      propertyId: original.propertyId,
      portalId: original.portalId,
      portalGroupId: original.portalGroupId,
      accessArtifactId: original.accessArtifactId,
      supersedesSourceEventId: original.eventId,
      occurredAt: new Date('2026-08-28T10:01:00.000Z'),
    })
    await expect(store.retractQualifiedScan(correction)).resolves.toBe('applied')
    await expect(store.retractQualifiedScan(correction)).resolves.toBe('duplicate')

    expect(
      await getPool().query(
        `SELECT count(*)::int AS count
         FROM outbox_events
         WHERE organization_id = $1
           AND event_type = 'guest.qualified_scan.retracted'`,
        [ORG],
      ),
    ).toMatchObject({ rows: [{ count: 1 }] })
  })

  it('projects one replay-safe Metric contribution and removes it by correction', async () => {
    const events = createCapturingEventBus()
    const commandStore = createAtomicMetricCommandStore(getDb(), events, randomUUID)
    const readingIds = [
      metricReadingId('73000000-0000-4000-8000-000000000021'),
      metricReadingId('73000000-0000-4000-8000-000000000022'),
    ]
    const record = recordMetric({
      commandStore,
      registry: createMetricRegistryRepository(getDb()),
      idGen: () => readingIds.shift()!,
      clock: () => EVENT_TIME,
      resolvePropertyLocalDate: async () => '2026-08-27',
    })
    const fact = guestQualifiedScanRecorded({
      qualifiedScanId: qualifiedScanId('73000000-0000-4000-8000-000000000023'),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      portalGroupId: GROUP_AT_EVENT,
      accessArtifactId: ARTIFACT,
      occurredAt: EVENT_TIME,
    })
    await getPool().query(
      `INSERT INTO outbox_events (
         id, event_type, event_version, payload, organization_id, property_id,
         source_context, source_aggregate_id
       ) VALUES ($1, $2, 1, $3::jsonb, $4, $5, 'guest', $6)`,
      [
        fact.eventId,
        fact._tag,
        JSON.stringify({
          organizationId: fact.organizationId,
          propertyId: fact.propertyId,
          portalId: fact.portalId,
          qualifiedScanId: fact.qualifiedScanId,
          portalGroupId: fact.portalGroupId,
          accessArtifactId: fact.accessArtifactId,
          staffAttribution: fact.staffAttribution,
          occurredAt: fact.occurredAt.toISOString(),
        }),
        ORG,
        PROPERTY,
        fact.qualifiedScanId,
      ],
    )

    const recordedHandler = onQualifiedScanRecordedDurably({
      recordMetric: record,
      findGroupForPortal: async () => {
        throw new Error('replay must not re-resolve Portal Group membership')
      },
      logger: createMockLogger(),
    })

    await recordedHandler(fact)
    await recordedHandler(fact)

    const metrics = createMetricRepository(getDb(), () => EVENT_TIME)
    const aggregateQuery = {
      organizationId: ORG,
      propertyId: PROPERTY,
      definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
      expectedMetricKey: 'portal.qualified_scan' as const,
      allowedSourcePolicies: ['first_party_guest_gateway_metric' as const],
      subject: { kind: 'portal' as const, portalId: PORTAL },
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
    }
    await expect(metrics.queryGoalAggregate(aggregateQuery)).resolves.toMatchObject({
      sum: 1,
      sampleCount: 1,
      readingCount: 1,
    })

    const correction = guestQualifiedScanRetracted({
      qualifiedScanId: fact.qualifiedScanId,
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      portalGroupId: GROUP_AT_EVENT,
      accessArtifactId: ARTIFACT,
      supersedesSourceEventId: fact.eventId,
      occurredAt: new Date('2026-08-27T12:00:00.000Z'),
    })
    const retractedHandler = onQualifiedScanRetractedDurably({
      retractMetric: retractMetric(commandStore),
      logger: createMockLogger(),
    })
    await retractedHandler(correction)
    await retractedHandler(correction)

    await expect(metrics.queryGoalAggregate(aggregateQuery)).resolves.toMatchObject({
      sum: 0,
      sampleCount: 0,
      readingCount: 0,
    })
    expect(
      await getPool().query(
        `SELECT count(*)::int AS count
         FROM metric_corrections
         WHERE source_event_id = $1`,
        [`${correction.eventId}:${METRIC_VERSION_IDS.qualifiedScanGoal}`],
      ),
    ).toMatchObject({ rows: [{ count: 1 }] })
  })
})
