// Guest-response erasure through the rights command with journaling, then a
// restore replay through the production replayer set, for two tenants.

import { metricRegistry } from '../contexts/reporting/readings/contracts'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { applyRestoreResurrectionFence } from '#/shared/db/lifecycle/backup-erasure-ledger'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createGuestRightsExecutor } from '#/contexts/guest/infrastructure/adapters/guest-rights.adapter'
import { createNotificationRightsReplayers } from '#/contexts/feed/rights/replayer.server'
import { runRightsExecutors } from '#/shared/ops/rights/rights-executor'
import {
  createRightsJournal,
  type RightsJournalStore,
} from '#/shared/ops/rights/rights-journal'
import {
  metricReadingId,
  organizationId as toOrganizationId,
  portalId as toPortalId,
  propertyId as toPropertyId,
  ratingId as toRatingId,
} from '#/shared/domain/ids'
import { recordMetrics } from '#/contexts/reporting/application/use-cases/record-metric'
import { retractMetrics } from '#/contexts/reporting/application/use-cases/retract-metric'
import { createAtomicMetricCommandStore } from '#/contexts/reporting/readings/metric-command-store.server'
import {
  onRatingRetractedDurably,
  onRatingSubmittedDurably,
} from '#/contexts/reporting/readings/record-portal-metric.server'
import { createPropertyLocalDateResolver } from '#/contexts/reporting/infrastructure/repositories/property-local-date'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { composeRightsReplayers } from './rights-executors'

const AT = new Date('2026-09-15T12:00:00.000Z')
const RESTORE_POINT = new Date('2026-07-01T00:00:00.000Z')
const OPERATOR = 'operator-replay'

type Tenant = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  responseId: string
  ratingSourceEventId: string
  feedbackSourceEventId: string
}>

const organizations = new Set<string>()
let lease: TestLease
let db: Database
const q = (text: string, params: unknown[] = []) => lease.pool.query(text, params)

async function seedTenant(): Promise<Tenant> {
  const organizationId = `replay-${randomUUID()}`
  const propertyId = randomUUID()
  const portalId = randomUUID()
  const responseId = randomUUID()
  const ratingSourceEventId = randomUUID()
  const feedbackSourceEventId = randomUUID()
  organizations.add(organizationId)
  await q(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Replay Fixture', $1, $2)`,
    [organizationId, AT],
  )
  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1::uuid, $2, 'Replay Property', $4, 'UTC', $3, $3)`,
    [propertyId, organizationId, AT, `replay-${propertyId}`],
  )
  await q(
    `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug,
                          publication_state, created_at, updated_at)
     VALUES ($1::uuid, $2, $3::uuid, $3::uuid, 'Front Desk', $5, 'published', $4, $4)`,
    [portalId, organizationId, propertyId, AT, `portal-${portalId}`],
  )
  await q(
    `INSERT INTO guest_responses (
       id, organization_id, property_id, portal_id, status, rating, response_consent,
       text_consent, private_feedback_threshold, correction_count,
       rating_source_event_id, feedback_source_event_id, submitted_at,
       feedback_submitted_at, feedback_submission_revision, retention_deadline,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'submitted', 2, true, true, 3, 0, $5, $6, $7, $7, 1,
               $7::timestamptz + interval '700 days', $7, $7)`,
    [
      responseId,
      organizationId,
      propertyId,
      portalId,
      ratingSourceEventId,
      feedbackSourceEventId,
      AT,
    ],
  )
  await q(
    `INSERT INTO guest_response_private_feedback (
       response_id, organization_id, property_id, portal_id, body, submitted_at,
       expires_at, created_at
     ) VALUES ($1, $2, $3, $4, 'fixture feedback', $5, $5::timestamptz + interval '88 days', $5)`,
    [responseId, organizationId, propertyId, portalId, AT],
  )
  await submitRatingReading({
    organizationId,
    propertyId,
    portalId,
    responseId,
    ratingSourceEventId,
    feedbackSourceEventId,
  })
  return {
    organizationId,
    propertyId,
    portalId,
    responseId,
    ratingSourceEventId,
    feedbackSourceEventId,
  }
}

const metricDeps = () => ({
  commandStore: createAtomicMetricCommandStore(db, randomUUID),
  registry: metricRegistry,
  clock: () => AT,
  idGen: () => metricReadingId(randomUUID()),
  resolvePropertyLocalDate: createPropertyLocalDateResolver(db),
})

/** Reporting's reading of the rating, as delivered before the erasure. */
async function submitRatingReading(tenant: Tenant): Promise<void> {
  await q(
    `INSERT INTO outbox_events (
       id, event_type, event_version, payload, organization_id, property_id,
       source_context, source_aggregate_id, created_at, published_at
     ) VALUES ($1::uuid, 'guest.rating.submitted', 1, $2::jsonb, $3, $4, 'guest', $5, $6, $6)`,
    [
      tenant.ratingSourceEventId,
      JSON.stringify({
        ratingId: tenant.responseId,
        organizationId: tenant.organizationId,
        propertyId: tenant.propertyId,
        portalId: tenant.portalId,
        value: 2,
        occurredAt: AT.toISOString(),
      }),
      tenant.organizationId,
      tenant.propertyId,
      tenant.responseId,
      AT,
    ],
  )
  await onRatingSubmittedDurably({
    recordMetrics: recordMetrics(metricDeps()),
    findGroupForPortal: async () => null,
  })({
    _tag: 'guest.rating.submitted',
    eventId: tenant.ratingSourceEventId,
    correlationId: null,
    ratingId: toRatingId(tenant.responseId),
    organizationId: toOrganizationId(tenant.organizationId),
    propertyId: toPropertyId(tenant.propertyId),
    portalId: toPortalId(tenant.portalId),
    value: 2,
    supersedesSourceEventId: null,
    occurredAt: AT,
    staffAttribution: null,
  })
}

/** Readings of the tenant's rating that carry a retraction. */
async function retractedReadings(tenant: Tenant): Promise<number> {
  const { rows } = await q(
    `SELECT count(*)::int AS n
     FROM metric_corrections c JOIN metric_readings r ON r.id = c.reading_id
     WHERE r.organization_id = $1 AND r.source_event_id = $2 AND c.kind = 'retract'`,
    [tenant.organizationId, tenant.ratingSourceEventId],
  )
  return rows[0].n
}

/** Retraction facts waiting in the outbox for the tenant's response. */
async function retractionFacts(tenant: Tenant) {
  const { rows } = await q(
    `SELECT id, event_type, payload FROM outbox_events
     WHERE organization_id = $1 AND event_type IN ('guest.rating.retracted', 'guest.feedback.retracted')
     ORDER BY event_type`,
    [tenant.organizationId],
  )
  return rows as Array<{
    id: string
    event_type: string
    payload: Record<string, unknown>
  }>
}

async function state(tenant: Tenant) {
  const response = await q(
    `SELECT status, rating FROM guest_responses WHERE id = $1 AND organization_id = $2`,
    [tenant.responseId, tenant.organizationId],
  )
  const feedback = await q(
    `SELECT count(*)::int AS n FROM guest_response_private_feedback
     WHERE response_id = $1 AND organization_id = $2`,
    [tenant.responseId, tenant.organizationId],
  )
  return { ...response.rows[0], feedback: feedback.rows[0]?.n }
}

describe('guest response erasure replay', () => {
  beforeAll(async () => {
    registerAllEventSchemas()
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
  })
  afterAll(async () => lease.release())
  afterEach(async () => {
    for (const organizationId of organizations) {
      await q('DELETE FROM guest_response_private_feedback WHERE organization_id = $1', [
        organizationId,
      ])
      await q('DELETE FROM guest_responses WHERE organization_id = $1', [organizationId])
      await q(
        `DELETE FROM metric_corrections
         WHERE reading_id IN (SELECT id FROM metric_readings WHERE organization_id = $1)`,
        [organizationId],
      )
      await q('DELETE FROM metric_readings WHERE organization_id = $1', [organizationId])
      await q('DELETE FROM outbox_events WHERE organization_id = $1', [organizationId])
      await q('DELETE FROM portals WHERE organization_id = $1', [organizationId])
      await q('DELETE FROM properties WHERE organization_id = $1', [organizationId])
    }
    await deleteTestOrganizations(lease.pool, [...organizations])
    organizations.clear()
  })

  it('erases one tenant response again after a restore and leaves the other tenant alone', async () => {
    const erased = await seedTenant()
    const untouched = await seedTenant()
    const untouchedBefore = await state(untouched)
    const written = new Map<string, string>()
    const store: RightsJournalStore = {
      put: async (key, bytes) => {
        written.set(key, bytes)
      },
      alert: () => {},
    }

    const code = await runRightsExecutors({
      plan: {
        scope: 'guest-response',
        mode: 'apply',
        organizationId: erased.organizationId,
        propertyId: erased.propertyId,
        responseId: erased.responseId,
        batchSize: 50,
        receivedAt: AT,
      },
      executors: [
        createGuestRightsExecutor({
          db,
          now: () => AT,
          idGen: randomUUID,
          operator: {
            id: OPERATOR,
            authority: { verify: async (id) => id === OPERATOR },
          },
        }),
      ],
      journal: createRightsJournal(store),
      io: { out: () => {}, err: () => {} },
      writeExportFile: async () => {},
    })
    expect(code).toBe(0)
    expect(await state(erased)).toMatchObject({ status: 'deleted', rating: null })

    expect((await retractionFacts(erased)).map((fact) => fact.event_type)).toEqual([
      'guest.feedback.retracted',
      'guest.rating.retracted',
    ])

    // The restore brings the response, its feedback and its source events back,
    // and drops what the erasure published after the restore point.
    await q(
      `UPDATE guest_responses SET status = 'submitted', rating = 2, deleted_at = NULL,
         rating_source_event_id = $2, feedback_source_event_id = $3
       WHERE id = $1`,
      [erased.responseId, erased.ratingSourceEventId, erased.feedbackSourceEventId],
    )
    await q(
      `DELETE FROM outbox_events WHERE organization_id = $1
       AND event_type IN ('guest.rating.retracted', 'guest.feedback.retracted')`,
      [erased.organizationId],
    )
    await q(
      `INSERT INTO guest_response_private_feedback (
         response_id, organization_id, property_id, portal_id, body, submitted_at,
         expires_at, created_at
       ) SELECT $1, organization_id, property_id, portal_id, 'restored', $2,
                $2::timestamptz + interval '88 days', $2
         FROM guest_responses WHERE id = $1`,
      [erased.responseId, AT],
    )
    expect(await state(erased)).toMatchObject({ status: 'submitted', feedback: 1 })

    const replayers = composeRightsReplayers({
      db,
      now: () => AT,
      auditPseudonymSecret: 'audit-pseudonym-test-secret',
      notificationReplayers: createNotificationRightsReplayers(),
    })
    const outcome = await db.transaction((tx) =>
      applyRestoreResurrectionFence(tx, {
        entries: [...written.values()].map(decodeErasureJournalEntry),
        restorePointAt: RESTORE_POINT,
        replayers,
      }),
    )

    expect(outcome.verified).toBe(true)
    expect(outcome.counts.ledgerEntriesReapplied).toBe(1)
    expect(await state(erased)).toMatchObject({
      status: 'deleted',
      rating: null,
      feedback: 0,
    })
    expect(await state(untouched)).toEqual(untouchedBefore)

    // The readings built from the restored response are scrubbed by the facts
    // replay publishes, and only for the erased tenant.
    const facts = await retractionFacts(erased)
    expect(
      facts.map(({ event_type, payload }) => [
        event_type,
        payload.supersedesSourceEventId,
      ]),
    ).toEqual([
      ['guest.feedback.retracted', erased.feedbackSourceEventId],
      ['guest.rating.retracted', erased.ratingSourceEventId],
    ])
    expect(await retractionFacts(untouched)).toEqual([])
    expect(await retractedReadings(erased)).toBe(0)
    const ratingFact = facts.find((fact) => fact.event_type === 'guest.rating.retracted')!
    await onRatingRetractedDurably({
      retractMetrics: retractMetrics(metricDeps().commandStore),
    })({
      _tag: 'guest.rating.retracted',
      eventId: ratingFact.id,
      correlationId: null,
      ratingId: toRatingId(erased.responseId),
      organizationId: toOrganizationId(erased.organizationId),
      propertyId: toPropertyId(erased.propertyId),
      portalId: toPortalId(erased.portalId),
      supersedesSourceEventId: erased.ratingSourceEventId,
      occurredAt: AT,
      staffAttribution: null,
    })
    expect(await retractedReadings(erased)).toBeGreaterThan(0)
    expect(await retractedReadings(untouched)).toBe(0)
  })
})
