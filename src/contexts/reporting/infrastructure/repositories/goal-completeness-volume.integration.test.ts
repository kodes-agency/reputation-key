import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import { createPortalGroupPublicApi } from '#/contexts/portal/infrastructure/portal-group-public-api'
import { createPortalGroupRepository } from '#/contexts/portal/infrastructure/repositories/portal-group.repository'
import { METRIC_VERSION_IDS } from '../../readings/contracts'
import {
  createGoalMetricSourceStatus,
  goalMetricSourceStatusQuery,
} from './goal-metric-source-status'

describe.sequential('Goal source completeness at volume (integration)', () => {
  let held: HeldTransaction | undefined
  let statements = 0
  const org = organizationId(`goal-completeness-${randomUUID()}`)
  const property = propertyId(randomUUID())
  const portal = randomUUID()
  const previousGroup = portalGroupId(randomUUID())
  const currentGroup = portalGroupId(randomUUID())
  const start = new Date('2026-06-01T00:00:00Z')
  const moved = new Date('2026-06-16T00:00:00Z')
  const end = new Date('2026-07-01T00:00:00Z')

  beforeAll(async () => {
    held = await holdTransaction({
      logger: {
        logQuery: () => {
          statements += 1
        },
      },
    })
    const { client } = held
    await client.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Completeness', $1, now())`,
      [org],
    )
    await client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1::uuid, $2, 'Completeness', $1::text, 'UTC')`,
      [property, org],
    )
    await client.query(
      `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id,
                            name, slug, publication_state)
       VALUES ($1::uuid, $2, $3::uuid, 'property', $3::text, 'Desk', $1::text, 'published')`,
      [portal, org, property],
    )
    await client.query(
      `INSERT INTO portal_groups (id, organization_id, property_id, name)
       VALUES ($1, $3, $4, 'Previous desk'), ($2, $3, $4, 'Current desk')`,
      [previousGroup, currentGroup, org, property],
    )
    await client.query(
      `INSERT INTO portal_group_memberships
         (organization_id, property_id, portal_id, portal_group_id,
          effective_from, effective_to, created_by)
       VALUES ($1, $2, $3, $4, $6, $7, 'manager'),
              ($1, $2, $3, $5, $7, NULL, 'manager')`,
      [org, property, portal, previousGroup, currentGroup, start, moved],
    )
    await client.query(
      `WITH facts AS (
         SELECT gen_random_uuid() AS id, n,
           CASE WHEN n <= 500 THEN timestamptz '2026-06-15T12:00:00Z'
                ELSE timestamptz '2026-06-16T00:00:00Z' END AS occurred
         FROM generate_series(1, 1000) AS n
       ), sources AS (
         INSERT INTO outbox_events
           (id, event_type, event_version, payload, organization_id, property_id,
            source_context, source_aggregate_id, created_at)
         SELECT id, 'guest.rating.submitted', 1,
           jsonb_build_object('portalId', $3::text, 'occurredAt', occurred)
             || CASE WHEN n = 1 THEN '{"portalGroupId":null}'::jsonb
                     WHEN n = 1000 THEN jsonb_build_object('portalGroupId', $4::text)
                     ELSE '{}'::jsonb END,
           $1, $2::uuid, 'guest', id::text, occurred
         FROM facts RETURNING id
       ), receipts AS (
         INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
         SELECT id, 'metric.guest-analytics', 'applied' FROM sources
       )
       INSERT INTO metric_readings
         (organization_id, property_id, portal_id, group_id, metric_key, value,
          recorded_at, definition_version_id, source_event_id, source_policy,
          exact_value, sample_count, attribution_quality, event_at,
          property_local_date, data_quality, retention_class)
       SELECT $1, $2::uuid, $3::uuid,
         CASE WHEN n = 1 THEN NULL WHEN n <= 500 OR n = 1000 THEN $4::uuid
              ELSE $5::uuid END,
         'portal.rating_count', 1, occurred, $6, id::text,
         'first_party_guest_gateway_metric', 1, 1, 'exact', occurred,
         occurred::date, 'exact', 'guest_gateway_24_month'
       FROM facts`,
      [
        org,
        property,
        portal,
        previousGroup,
        currentGroup,
        METRIC_VERSION_IDS.portalRatingCountGoal,
      ],
    )
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  it('proves 1,000 facts in one statement, preserving historic and captured attribution', async () => {
    if (!held) throw new Error('Completeness fixture is unavailable')
    const groups = createPortalGroupPublicApi(
      createPortalGroupRepository(held.db),
      () => end,
    )
    // Derive the expected attribution through Portal, outside the measured read.
    const previous = await groups.findGroupForPortal(
      org,
      portalId(portal),
      new Date('2026-06-15T12:00:00Z'),
    )
    const current = await groups.findGroupForPortal(org, portalId(portal), moved)
    expect(previous?.id).toBe(previousGroup)
    expect(current?.id).toBe(currentGroup)
    const inspect = createGoalMetricSourceStatus(held.db).inspect
    statements = 0

    const query = {
      organizationId: org,
      propertyId: property,
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      expectedMetricKey: 'portal.rating_count' as const,
      allowedSourcePolicies: ['first_party_guest_gateway_metric'],
      subject: { kind: 'portal_group' as const, portalGroupId: previousGroup },
      periodStart: start,
      periodEnd: end,
    }
    const answer = await inspect(query, [
      'guest.rating.submitted',
      'guest.rating.retracted',
    ])

    expect(answer).toEqual({
      state: 'complete',
      relevantFactCount: 500,
      pendingFactCount: 0,
      reason: null,
    })
    expect(statements).toBe(1)
    const sources = await held.db.execute(
      goalMetricSourceStatusQuery(query, ['guest.rating.submitted']),
    )
    expect(sources.rows).toHaveLength(1000)
    const historical = new Map<string, string | null>()
    let expectedCount = 0
    for (const source of sources.rows) {
      const payload = source['payload'] as {
        portalId: string
        occurredAt: string
        portalGroupId?: string | null
      }
      const key = `${payload.portalId}:${payload.occurredAt}`
      if (!Object.hasOwn(payload, 'portalGroupId') && !historical.has(key)) {
        const group = await groups.findGroupForPortal(
          org,
          portalId(payload.portalId),
          new Date(payload.occurredAt),
        )
        historical.set(key, group?.id ?? null)
      }
      const expected = Object.hasOwn(payload, 'portalGroupId')
        ? payload.portalGroupId
        : historical.get(key)
      expect(source['expected_group_id']).toBe(expected)
      if (expected === previousGroup) expectedCount += 1
    }
    expect(answer.relevantFactCount).toBe(expectedCount)
  })

  it('matches Portal membership authority at move and archive boundaries and across scopes', async () => {
    if (!held) throw new Error('Completeness fixture is unavailable')
    const { db, client } = held
    const groups = createPortalGroupPublicApi(createPortalGroupRepository(db), () => end)
    await client.query('SAVEPOINT attribution_parity')
    try {
      await client.query('UPDATE portal_groups SET deleted_at = $1 WHERE id = $2', [
        new Date('2026-06-20T00:00:00Z'),
        currentGroup,
      ])
      await client.query('DELETE FROM outbox_events WHERE organization_id = $1', [org])
      await client.query(
        'UPDATE portal_group_memberships SET effective_from = $1 WHERE portal_group_id = $2',
        [new Date('2026-06-17T00:00:00Z'), currentGroup],
      )
      const cases = [
        { at: '2026-05-31T23:59:59.999Z', group: null },
        { at: '2026-06-01T00:00:00Z', group: previousGroup },
        { at: '2026-06-15T23:59:59.999Z', group: previousGroup },
        { at: '2026-06-16T00:00:00Z', group: null },
        { at: '2026-06-17T00:00:00Z', group: currentGroup },
        { at: '2026-06-19T23:59:59.999Z', group: currentGroup },
        { at: '2026-06-20T00:00:00Z', group: null },
        { at: '2026-06-21T00:00:00Z', group: null },
      ]
      for (const entry of cases) {
        const event = randomUUID()
        await client.query(
          `INSERT INTO outbox_events
            (id, event_type, event_version, payload, organization_id, property_id,
             source_context, source_aggregate_id)
           VALUES ($1::uuid, 'guest.rating.submitted', 1,
             jsonb_build_object('portalId', $2::text, 'occurredAt', $3::text),
             $4, $5, 'guest', $1::text)`,
          [event, portal, entry.at, org, property],
        )
        const authority = await groups.findGroupForPortal(
          org,
          portalId(portal),
          new Date(entry.at),
        )
        expect(authority?.id ?? null).toBe(entry.group)
      }
      const query = {
        organizationId: org,
        propertyId: property,
        definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
        expectedMetricKey: 'portal.rating_count' as const,
        allowedSourcePolicies: ['first_party_guest_gateway_metric'],
        subject: { kind: 'property' as const, propertyId: property },
        periodStart: new Date('2026-05-31T00:00:00Z'),
        periodEnd: end,
      }
      const rows = await db.execute(
        goalMetricSourceStatusQuery(query, ['guest.rating.submitted']),
      )
      expect(rows.rows).toHaveLength(cases.length)
      for (const row of rows.rows) {
        const payload = row['payload'] as { portalId: string; occurredAt: string }
        const authority = await groups.findGroupForPortal(
          org,
          portalId(payload.portalId),
          new Date(payload.occurredAt),
        )
        expect(row['expected_group_id']).toBe(authority?.id ?? null)
      }
      // A real Property in another scope must not gain attribution from this Portal.
      const otherProperty = propertyId(randomUUID())
      await client.query(
        `INSERT INTO properties (id, organization_id, name, slug, timezone)
         VALUES ($1::uuid, $2, 'Other', $1::text, 'UTC')`,
        [otherProperty, org],
      )
      await client.query(
        'UPDATE outbox_events SET property_id = $1 WHERE organization_id = $2',
        [otherProperty, org],
      )
      const scoped = await db.execute(
        goalMetricSourceStatusQuery({ ...query, propertyId: otherProperty }, [
          'guest.rating.submitted',
        ]),
      )
      expect(scoped.rows).toHaveLength(cases.length)
      for (const row of scoped.rows) expect(row['expected_group_id']).toBeNull()
      expect(
        await groups.findGroupForPortal(
          organizationId('missing-organization'),
          portalId(portal),
          moved,
        ),
      ).toBeNull()
      const denied = await db.execute(
        goalMetricSourceStatusQuery(
          { ...query, organizationId: organizationId('missing-organization') },
          ['guest.rating.submitted'],
        ),
      )
      expect(denied.rows).toEqual([])
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT attribution_parity')
    }
  })
})
