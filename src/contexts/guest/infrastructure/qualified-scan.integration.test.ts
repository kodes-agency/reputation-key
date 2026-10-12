import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import {
  organizationId,
  portalAccessArtifactId,
  portalGroupId,
  portalId,
  portalLinkId,
  propertyId,
  qualifiedScanId,
  scanEventId,
} from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  guestQualifiedScanRecorded,
  guestQualifiedScanRetracted,
  guestReviewLinkClicked,
  guestScanRecorded,
} from '../domain/events'
import { createPortalGroupRepository } from '#/contexts/portal/infrastructure/repositories/portal-group.repository'
import { createPortalAccessArtifactRepository } from '#/contexts/portal/infrastructure/repositories/portal-access-artifact.repository'
import { createAtomicGuestObservationStore } from './guest-observation-store'
import {
  buildReportingContext,
  type ReportingContextBuildInput,
} from '#/contexts/reporting/build'
import { METRIC_VERSION_IDS } from '#/contexts/reporting/application/public-api'
import {
  createConsumerRegistry,
  type ConsumerEvent,
  type ConsumerHandler,
  type ConsumerRegistry,
} from '#/shared/outbox'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'

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
const DAY_MS = 24 * 60 * 60 * 1000

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
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

function buildReportingFixture() {
  const input: ReportingContextBuildInput = {
    db: getDb(),
    clock: () => EVENT_TIME,
    idGen: randomUUID,
    logger: createMockLogger(),
    portalGroupApi: {} as ReportingContextBuildInput['portalGroupApi'],
    portalApi: {} as ReportingContextBuildInput['portalApi'],
    reviewRatingLookup: {} as ReportingContextBuildInput['reviewRatingLookup'],
    propertyApi: {} as ReportingContextBuildInput['propertyApi'],
    staffPublicApi: {} as ReportingContextBuildInput['staffPublicApi'],
    reviewServingStats: {} as ReportingContextBuildInput['reviewServingStats'],
    inboxTargets: {} as ReportingContextBuildInput['inboxTargets'],
    guestResponseIntegrity: {} as ReportingContextBuildInput['guestResponseIntegrity'],
  }
  const context = buildReportingContext(input)
  const registry = createConsumerRegistry()
  context.worker.registerOutboxConsumers(registry, {
    authorize: async () => undefined,
  })
  return { context, registry }
}

function metricConsumer(registry: ConsumerRegistry, eventType: string): ConsumerHandler {
  const registration = registry
    .listFor(eventType)
    .find(({ consumerName }) => consumerName === 'metric.guest-analytics')
  if (!registration) {
    throw new Error(`Reporting consumer is not registered for ${eventType}`)
  }
  return registration.handler
}

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

/** Runs the named sweep rules with the cutoff the scheduled job gives each at `at`. */
async function sweepAt(at: Date, subjects: ReadonlyArray<string>): Promise<void> {
  for (const subject of subjects) {
    const rule = RETENTION_RULES.find((candidate) => candidate.subject === subject)
    if (!rule) throw new Error(`No retention rule has the subject ${subject}`)
    await executeRetentionRule(getDb(), rule, {
      cutoff: new Date(at.getTime() - rule.olderThanMs),
    })
  }
}

function guestReceipts() {
  return getPool().query<{ scope: string; key: string; session_id: string }>(
    `SELECT scope, key, payload->>'sessionId' AS session_id
     FROM idempotency_receipts
     WHERE scope IN ('guest_qualified_scan', 'guest_destination_action')
       AND payload->>'organizationId' = $1
     ORDER BY scope`,
    [ORG],
  )
}

async function cleanMetricState(): Promise<void> {
  await getPool().query(
    `DELETE FROM idempotency_receipts
     WHERE scope IN ('guest_qualified_scan', 'guest_destination_action')
       AND payload->>'organizationId' = $1`,
    [ORG],
  )
  await getPool().query(`DELETE FROM scan_events WHERE organization_id = $1`, [ORG])
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
    const store = createAtomicGuestObservationStore(getDb())
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

    const outcomes = await Promise.all([
      store.commitQualifiedScan(first.scan, SESSION, first.fact),
      store.commitQualifiedScan(concurrent.scan, SESSION, concurrent.fact),
    ])
    expect(outcomes).toEqual(expect.arrayContaining(['applied', 'duplicate']))
    const original = outcomes[0] === 'applied' ? first.fact : concurrent.fact
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

    expect(
      await getPool().query(
        `SELECT count(*)::int AS count
         FROM guest_qualified_scans
         WHERE organization_id = $1`,
        [ORG],
      ),
    ).toMatchObject({ rows: [{ count: 2 }] })

    const recorded = await getPool().query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'guest.qualified_scan.recorded'`,
      [ORG],
    )
    expect(recorded.rows).toHaveLength(2)
    expect(recorded.rows).toContainEqual({ id: original.eventId })
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

  it('keeps the session identifier in both Guest receipts after the one-day session sweep, until the 30-day receipt rule', async () => {
    // The retention the Privacy Notice states (section 6, since version 2.1):
    // the session's own records lose the identifier after a day, the two
    // duplicate-prevention receipts keep it for the shared 30 days.
    const store = createAtomicGuestObservationStore(getDb())
    const visitId = scanEventId('73000000-0000-4000-8000-000000000021')
    await store.commitScan(
      {
        id: visitId,
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        source: 'qr',
        sessionId: SESSION,
        ipHash: null,
        createdAt: EVENT_TIME,
      },
      guestScanRecorded({
        scanId: visitId,
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        scanSource: 'qr',
        occurredAt: EVENT_TIME,
      }),
    )
    const scanId = qualifiedScanId('73000000-0000-4000-8000-000000000022')
    const scanFact = guestQualifiedScanRecorded({
      qualifiedScanId: scanId,
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      portalGroupId: GROUP_AT_EVENT,
      accessArtifactId: ARTIFACT,
      occurredAt: EVENT_TIME,
    })
    await store.commitQualifiedScan(
      {
        id: scanId,
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        portalGroupId: GROUP_AT_EVENT,
        accessArtifactId: ARTIFACT,
        sourceEventId: scanFact.eventId,
        occurredAt: EVENT_TIME,
        staffAttribution: null,
      },
      SESSION,
      scanFact,
    )
    const selection = guestReviewLinkClicked({
      linkId: portalLinkId('73000000-0000-4000-8000-000000000023'),
      destinationKind: 'google_review',
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      occurredAt: EVENT_TIME,
    })
    await store.commitReviewLinkClick(
      {
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        sessionId: SESSION,
        destinationId: selection.linkId,
        destinationKind: selection.destinationKind,
        occurredAt: EVENT_TIME,
        expiresAt: new Date(EVENT_TIME.getTime() + DAY_MS),
      },
      selection,
    )
    const sessionIdentifierRules = [
      'scan_events.guest_session_pseudonym',
      'idempotency_receipts',
    ]

    await sweepAt(new Date(EVENT_TIME.getTime() + 2 * DAY_MS), sessionIdentifierRules)

    expect(
      await getPool().query(
        `SELECT session_id FROM scan_events WHERE organization_id = $1`,
        [ORG],
      ),
    ).toMatchObject({ rows: [{ session_id: null }] })
    const afterSessionSweep = await guestReceipts()
    expect(
      afterSessionSweep.rows.map(({ scope, key, session_id }) => ({
        scope,
        sessionInPayload: session_id,
        sessionInKey: (JSON.parse(key) as string[]).includes(SESSION),
      })),
    ).toEqual([
      {
        scope: 'guest_destination_action',
        sessionInPayload: SESSION,
        sessionInKey: true,
      },
      { scope: 'guest_qualified_scan', sessionInPayload: SESSION, sessionInKey: true },
    ])

    await sweepAt(new Date(EVENT_TIME.getTime() + 30 * DAY_MS), sessionIdentifierRules)
    expect((await guestReceipts()).rows.map(({ scope }) => scope)).toEqual([
      'guest_destination_action',
      'guest_qualified_scan',
    ])

    await sweepAt(
      new Date(EVENT_TIME.getTime() + 30 * DAY_MS + 1),
      sessionIdentifierRules,
    )
    expect((await guestReceipts()).rows).toEqual([])
  })

  it('projects one replay-safe Metric contribution and removes it by correction', async () => {
    const { context, registry } = buildReportingFixture()
    const fact = guestQualifiedScanRecorded({
      qualifiedScanId: qualifiedScanId('73000000-0000-4000-8000-000000000023'),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      portalGroupId: GROUP_AT_EVENT,
      accessArtifactId: ARTIFACT,
      occurredAt: EVENT_TIME,
    })
    const recordedPayload = {
      organizationId: fact.organizationId,
      propertyId: fact.propertyId,
      portalId: fact.portalId,
      qualifiedScanId: fact.qualifiedScanId,
      portalGroupId: fact.portalGroupId,
      accessArtifactId: fact.accessArtifactId,
      staffAttribution: fact.staffAttribution,
      occurredAt: fact.occurredAt.toISOString(),
    }
    await getPool().query(
      `INSERT INTO outbox_events (
         id, event_type, event_version, payload, organization_id, property_id,
         source_context, source_aggregate_id
       ) VALUES ($1, $2, 1, $3::jsonb, $4, $5, 'guest', $6)`,
      [
        fact.eventId,
        fact._tag,
        JSON.stringify(recordedPayload),
        ORG,
        PROPERTY,
        fact.qualifiedScanId,
      ],
    )
    const recordedEnvelope = {
      eventId: fact.eventId,
      eventType: fact._tag,
      eventVersion: 1,
      payload: recordedPayload,
      organizationId: fact.organizationId,
      propertyId: fact.propertyId,
      sourceContext: 'guest',
      sourceAggregateId: fact.qualifiedScanId,
      occurredAt: fact.occurredAt.toISOString(),
    } satisfies ConsumerEvent
    const recordedHandler = metricConsumer(registry, fact._tag)

    await recordedHandler(recordedEnvelope)
    await recordedHandler(recordedEnvelope)

    const aggregateQuery = {
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      groupId: null,
      metricKey: 'portal.qualified_scan' as const,
      consumer: 'goal' as const,
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
    }
    await expect(context.publicApi.queryAggregate(aggregateQuery)).resolves.toMatchObject(
      {
        sum: 1,
        count: 1,
        sampleCount: 1,
      },
    )

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
    const retractedPayload = {
      organizationId: correction.organizationId,
      propertyId: correction.propertyId,
      portalId: correction.portalId,
      qualifiedScanId: correction.qualifiedScanId,
      portalGroupId: correction.portalGroupId,
      accessArtifactId: correction.accessArtifactId,
      supersedesSourceEventId: correction.supersedesSourceEventId,
      staffAttribution: correction.staffAttribution,
      occurredAt: correction.occurredAt.toISOString(),
    }
    await getPool().query(
      `INSERT INTO outbox_events (
         id, event_type, event_version, payload, organization_id, property_id,
         source_context, source_aggregate_id
       ) VALUES ($1, $2, 1, $3::jsonb, $4, $5, 'guest', $6)`,
      [
        correction.eventId,
        correction._tag,
        JSON.stringify(retractedPayload),
        ORG,
        PROPERTY,
        correction.qualifiedScanId,
      ],
    )
    const retractedEnvelope = {
      eventId: correction.eventId,
      eventType: correction._tag,
      eventVersion: 1,
      payload: retractedPayload,
      organizationId: correction.organizationId,
      propertyId: correction.propertyId,
      sourceContext: 'guest',
      sourceAggregateId: correction.qualifiedScanId,
      occurredAt: correction.occurredAt.toISOString(),
    } satisfies ConsumerEvent
    const retractedHandler = metricConsumer(registry, correction._tag)

    await retractedHandler(retractedEnvelope)
    await retractedHandler(retractedEnvelope)

    await expect(context.publicApi.queryAggregate(aggregateQuery)).resolves.toMatchObject(
      {
        sum: 0,
        count: 0,
        sampleCount: 0,
      },
    )
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
