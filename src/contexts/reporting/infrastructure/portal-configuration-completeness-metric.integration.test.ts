// Portal configuration completeness, delivered into Metric against PostgreSQL.
// A fact counted on the legacy settings stays a reading of the legacy version;
// a fact counted on the Immersive Hub's fields is a reading of its own version,
// so each version's series holds only its own count (ADR 0041). A correction
// replaces a reading of its own version only: one that corrects a review
// counted on the other field set starts its own series, where passing the
// supersession on would be rejected and retried until the delivery budget ran
// out.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createConsumerRegistry } from '#/shared/outbox/consumer-registry'
import { metricReadingId, organizationId, propertyId } from '#/shared/domain/ids'
import { recordMetric } from '../application/use-cases/record-metric'
import { METRIC_VERSION_IDS } from '../domain/metric-registry'
import { createAtomicMetricCommandStore } from './metric-command-store'
import { registerPortalWorkflowMetricConsumers } from './outbox-consumers'
import { createMetricRegistryRepository } from './repositories/metric-registry.repository'
import { createMetricRepository } from './repositories/metric.repository'
import { createPropertyLocalDateResolver } from './repositories/property-local-date'

const ORG_ID = organizationId('org-completeness-0000-0000-000000000001')
const PROP_ID = propertyId('c8e00000-0000-4000-8000-000000000001')
const PORTAL_ID = 'c8e00000-0000-4000-8000-000000000002'
const NOW = new Date('2026-10-02T12:00:00.000Z')

const LEGACY = 'c8e00000-0000-4000-8000-0000000000a1'
const IMMERSIVE = 'c8e00000-0000-4000-8000-0000000000b1'
const CORRECTS_LEGACY = 'c8e00000-0000-4000-8000-0000000000a2'
const CORRECTS_IMMERSIVE = 'c8e00000-0000-4000-8000-0000000000b2'
const LEGACY_CORRECTS_IMMERSIVE = 'c8e00000-0000-4000-8000-0000000000b3'

let pool: Pool
const db = getDb()

type Fact = Readonly<{
  eventId: string
  eventVersion: 2 | 3
  reviewId: string
  revision: number
  supersedesSourceEventId: string | null
  completedFields: number
  occurredAt: string
}>

function payloadOf(fact: Fact): Record<string, unknown> {
  return {
    reviewId: fact.reviewId,
    revision: fact.revision,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    portalId: PORTAL_ID,
    portalGroupId: null,
    supersedesSourceEventId: fact.supersedesSourceEventId,
    sourceAggregateVersion: fact.occurredAt,
    occurredAt: fact.occurredAt,
    completedFields: fact.completedFields,
    requiredFields: 5,
    ...(fact.eventVersion === 3 ? { fieldSet: 'immersive_hub' } : {}),
  }
}

/** The outbox row the delivery receipt belongs to, then the consumer's own run. */
async function deliver(fact: Fact): Promise<unknown> {
  const payload = payloadOf(fact)
  await pool.query(
    `INSERT INTO outbox_events (
       id, event_type, event_version, payload, organization_id, property_id,
       source_context, source_aggregate_id
     ) VALUES ($1, 'portal.configuration_completeness.recorded', $2, $3::jsonb,
               $4, $5, 'portal', $6)`,
    [
      fact.eventId,
      fact.eventVersion,
      JSON.stringify(payload),
      ORG_ID,
      PROP_ID,
      fact.reviewId,
    ],
  )
  const registry = createConsumerRegistry()
  const metricRepo = createMetricRepository(db, () => NOW)
  registerPortalWorkflowMetricConsumers(registry, {
    recordMetric: recordMetric({
      commandStore: createAtomicMetricCommandStore(db, randomUUID),
      registry: createMetricRegistryRepository(),
      clock: () => NOW,
      idGen: () => metricReadingId(randomUUID()),
      resolvePropertyLocalDate: createPropertyLocalDateResolver(db),
    }),
    resolveAttribution: async () => ({ propertyId: PROP_ID, portalGroupId: null }),
    hasReading: metricRepo.hasReading,
  })
  const [consumer] = registry.listFor('portal.configuration_completeness.recorded')
  if (!consumer) throw new Error('completeness consumer was not registered')
  return consumer.handler({
    eventId: fact.eventId,
    eventType: 'portal.configuration_completeness.recorded',
    eventVersion: fact.eventVersion,
    payload,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    sourceContext: 'portal',
    sourceAggregateId: fact.reviewId,
    occurredAt: fact.occurredAt,
    recordedAt: fact.occurredAt,
  })
}

async function clean(): Promise<void> {
  await pool.query(
    `DELETE FROM metric_corrections
      WHERE reading_id IN (SELECT id FROM metric_readings WHERE organization_id = $1)`,
    [ORG_ID],
  )
  await pool.query('DELETE FROM metric_readings WHERE organization_id = $1', [ORG_ID])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG_ID])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Completeness Metric Org', 'completeness-metric-org', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG_ID],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Completeness Property', 'completeness-property', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_ID, ORG_ID],
  )
  await pool.query(
    `INSERT INTO portals (
       id, organization_id, property_id, entity_type, entity_id, name, slug,
       publication_state, created_at, updated_at
     ) VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Completeness Portal',
               'completeness-portal', 'published', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PORTAL_ID, ORG_ID, PROP_ID],
  )
})

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await clean()
})

afterAll(async () => {
  await clean()
  await pool.query('DELETE FROM portals WHERE id = $1', [PORTAL_ID])
  await pool.query('DELETE FROM properties WHERE id = $1', [PROP_ID])
  await deleteTestOrganizations(pool, [ORG_ID])
  await pool.end()
})

describe('Portal configuration completeness readings (integration)', () => {
  it('keeps legacy and Immersive Hub counts apart, and corrects each within its own version', async () => {
    const legacy: Fact = {
      eventId: LEGACY,
      eventVersion: 2,
      reviewId: 'review-legacy',
      revision: 1,
      supersedesSourceEventId: null,
      completedFields: 4,
      occurredAt: '2026-09-20T09:00:00.000Z',
    }
    const immersive: Fact = {
      eventId: IMMERSIVE,
      eventVersion: 3,
      reviewId: 'review-immersive',
      revision: 1,
      supersedesSourceEventId: null,
      completedFields: 5,
      occurredAt: '2026-10-02T09:00:00.000Z',
    }

    for (const fact of [
      legacy,
      immersive,
      {
        ...legacy,
        eventId: CORRECTS_LEGACY,
        eventVersion: 3,
        revision: 2,
        supersedesSourceEventId: LEGACY,
        completedFields: 5,
        occurredAt: '2026-10-02T10:00:00.000Z',
      } satisfies Fact,
      {
        ...immersive,
        eventId: CORRECTS_IMMERSIVE,
        revision: 2,
        supersedesSourceEventId: IMMERSIVE,
        completedFields: 3,
        occurredAt: '2026-10-02T11:00:00.000Z',
      } satisfies Fact,
    ]) {
      await expect(deliver(fact)).resolves.toEqual({ status: 'applied' })
    }

    const readings = await pool.query(
      `SELECT source_event_id, definition_version_id, exact_value::float AS value,
              numerator::float AS numerator, denominator::float AS denominator
         FROM metric_readings
        WHERE organization_id = $1
        ORDER BY event_at`,
      [ORG_ID],
    )
    expect(readings.rows).toEqual([
      {
        source_event_id: LEGACY,
        definition_version_id: METRIC_VERSION_IDS.configurationCompleteness,
        value: 80,
        numerator: 4,
        denominator: 5,
      },
      {
        source_event_id: IMMERSIVE,
        definition_version_id: METRIC_VERSION_IDS.configurationCompletenessImmersiveHub,
        value: 100,
        numerator: 5,
        denominator: 5,
      },
      {
        source_event_id: CORRECTS_LEGACY,
        definition_version_id: METRIC_VERSION_IDS.configurationCompletenessImmersiveHub,
        value: 100,
        numerator: 5,
        denominator: 5,
      },
      {
        source_event_id: CORRECTS_IMMERSIVE,
        definition_version_id: METRIC_VERSION_IDS.configurationCompletenessImmersiveHub,
        value: 60,
        numerator: 3,
        denominator: 5,
      },
    ])

    const corrected = await pool.query(
      `SELECT r.source_event_id
         FROM metric_corrections c
         JOIN metric_readings r ON r.id = c.reading_id
        WHERE r.organization_id = $1`,
      [ORG_ID],
    )
    // Only the Immersive Hub reading was replaced; the legacy one keeps its meaning.
    expect(corrected.rows).toEqual([{ source_event_id: IMMERSIVE }])
  })

  it('records a legacy correction of an Immersive Hub review as a fresh legacy reading', async () => {
    // Only a web instance still on the legacy count, during a deploy, sends one.
    const immersive: Fact = {
      eventId: IMMERSIVE,
      eventVersion: 3,
      reviewId: 'review-immersive',
      revision: 1,
      supersedesSourceEventId: null,
      completedFields: 5,
      occurredAt: '2026-10-02T09:00:00.000Z',
    }
    await deliver(immersive)

    await expect(
      deliver({
        ...immersive,
        eventId: LEGACY_CORRECTS_IMMERSIVE,
        eventVersion: 2,
        revision: 2,
        supersedesSourceEventId: IMMERSIVE,
        completedFields: 2,
        occurredAt: '2026-10-02T10:00:00.000Z',
      }),
    ).resolves.toEqual({ status: 'applied' })

    const readings = await pool.query(
      `SELECT source_event_id, definition_version_id
         FROM metric_readings
        WHERE organization_id = $1
        ORDER BY event_at`,
      [ORG_ID],
    )
    expect(readings.rows).toEqual([
      {
        source_event_id: IMMERSIVE,
        definition_version_id: METRIC_VERSION_IDS.configurationCompletenessImmersiveHub,
      },
      {
        source_event_id: LEGACY_CORRECTS_IMMERSIVE,
        definition_version_id: METRIC_VERSION_IDS.configurationCompleteness,
      },
    ])
    const corrections = await pool.query(
      `SELECT count(*)::int AS corrections
         FROM metric_corrections c
         JOIN metric_readings r ON r.id = c.reading_id
        WHERE r.organization_id = $1`,
      [ORG_ID],
    )
    expect(corrections.rows).toEqual([{ corrections: 0 }])
  })
})
