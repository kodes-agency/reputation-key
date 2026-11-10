import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import type { GoalProgramBundle } from '../../application/ports/goal-program.repository'
import type { GoalActor } from '../../monthly-goals/goal-programs.server'
import { listProgressOf } from '../../application/use-cases/goal-list-progress'
import { subjectMonthQuery } from '../../application/use-cases/goal-progress'
import { queryGoalMetric } from '../../application/use-cases/query-goal-metric'
import { createPortalRepository } from '#/contexts/portal/infrastructure/repositories/portal.repository'
import { createPortalGroupPublicApi } from '#/contexts/portal/infrastructure/portal-group-public-api'
import { createPortalGroupRepository } from '#/contexts/portal/infrastructure/repositories/portal-group.repository'
import { createGoalMetricBatchReader } from './goal-metric-batch-reader'
import { createGoalMetricSnapshotReader } from './goal-metric-snapshot'
import { createMetricRegistryRepository } from './metric-registry.repository'
import { createGoalProgramRepository } from './goal-program.repository'
import { seedCountReadings, seedGoalMonth } from '../testing/goal-running-month-seed'
import { METRIC_VERSION_IDS } from '../../readings/contracts'

describe.sequential('Goal list progress at volume (integration)', () => {
  let held: HeldTransaction | undefined
  let statements = 0
  let bundles: readonly GoalProgramBundle[] = []
  const organization = `goal-progress-${randomUUID()}`
  const property = randomUUID()
  const now = new Date('2026-08-09T12:00:00Z')
  const actor: GoalActor = {
    organizationId: organization,
    userId: 'manager-1',
    role: 'PropertyManager',
  }

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
       VALUES ($1, 'Progress', $1, now())`,
      [organization],
    )
    await client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1::uuid, $2, 'Progress', $1::text, 'UTC')`,
      [property, organization],
    )
    for (let index = 0; index < 60; index++) {
      const portal = randomUUID()
      await client.query(
        `INSERT INTO portals (id, organization_id, property_id, entity_type,
                              entity_id, name, slug, publication_state)
         VALUES ($1::uuid, $2, $3::uuid, 'property', $3::text,
                 $4, $1::text, 'published')`,
        [portal, organization, property, `Desk ${index + 1}`],
      )
      await seedGoalMonth(client, {
        organizationId: organization,
        propertyId: property,
        target: 120,
        subject: { kind: 'portal', portalId: portal },
      })
      await client.query(
        `WITH facts AS (
           SELECT gen_random_uuid() AS id FROM generate_series(1, $4::int)
         ), sources AS (
           INSERT INTO outbox_events
             (id, event_type, event_version, payload, organization_id, property_id,
              source_context, source_aggregate_id, created_at)
           SELECT id, 'guest.qualified_scan.recorded', 1,
             jsonb_build_object('portalId', $3::text, 'portalGroupId', NULL,
               'occurredAt', '2026-08-05T10:00:00Z'),
             $1, $2::uuid, 'guest', id::text, '2026-08-05T10:00:00Z'
           FROM facts RETURNING id
         ), receipts AS (
           INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
           SELECT id, 'metric.guest-analytics', 'applied' FROM sources
         )
         INSERT INTO metric_readings
           (organization_id, property_id, portal_id, metric_key, value,
            definition_version_id, source_event_id, source_policy, exact_value,
            sample_count, attribution_quality, recorded_at, event_at,
            property_local_date, data_quality, retention_class)
         SELECT $1, $2::uuid, $3::uuid, 'portal.qualified_scan', 1, $5, id::text,
           'first_party_guest_gateway_metric', 1, 1, 'exact',
           '2026-08-05T10:00:00Z', '2026-08-05T10:00:00Z', '2026-08-05',
           'exact', 'guest_gateway_24_month'
         FROM facts`,
        [organization, property, portal, 1, METRIC_VERSION_IDS.qualifiedScanGoal],
      )
      await seedCountReadings(client, {
        organizationId: organization,
        propertyId: property,
        portalId: portal,
        count: index,
        eventAt: '2026-08-05T10:00:00Z',
      })
    }
    bundles = await createGoalProgramRepository(held.db).list(organization, property)
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  it('reads all 60 goals with the same statement count as one goal and preserves each total', async () => {
    if (!held) throw new Error('Progress fixture is unavailable')
    const registry = createMetricRegistryRepository()
    const metrics = {
      queryGoalMetric: queryGoalMetric({
        registry,
        clock: () => now,
        validateSubject: async () => true,
        readSnapshot: createGoalMetricSnapshotReader(held.db),
      }),
      queryGoalMetrics: createGoalMetricBatchReader(held.db, registry, () => now),
    }
    statements = 0
    const one = await listProgressOf({ metrics }, bundles.slice(0, 1), now, actor)
    const oneStatements = statements
    statements = 0
    const sixty = await listProgressOf({ metrics }, bundles, now, actor)
    const sixtyStatements = statements

    expect(one).toHaveLength(1)
    expect(sixty).toHaveLength(60)
    expect(sixty[0]).toEqual(one[0])
    expect(
      sixty
        .map((entry) => entry.month?.reading)
        .sort(
          (a, b) =>
            (a?.kind === 'live' ? a.value : -1) - (b?.kind === 'live' ? b.value : -1),
        ),
    ).toEqual(
      Array.from({ length: 60 }, (_, index) => ({
        kind: 'live',
        value: index + 1,
        sampleCount: index + 1,
      })),
    )
    expect(oneStatements).toBeGreaterThan(0)
    expect(sixtyStatements).toBe(oneStatements)
    expect(sixtyStatements).toBeLessThanOrEqual(8)
  })

  it('keeps a missing projection and tenant denials in the batched read', async () => {
    if (!held) throw new Error('Progress fixture is unavailable')
    const { client, db } = held
    const first = bundles[0]!
    const second = bundles[1]!
    const queries = [first, second].map((bundle) =>
      subjectMonthQuery(
        bundle.version,
        bundle.assignments[0]!.subject,
        {
          start: new Date('2026-08-01T00:00:00Z'),
          end: new Date('2026-09-01T00:00:00Z'),
        },
        actor,
      ),
    )
    const subject = first.assignments[0]!.subject
    if (subject.kind !== 'portal') throw new Error('Expected a Portal goal')
    const registry = createMetricRegistryRepository()
    const read = createGoalMetricBatchReader(db, registry, () => now)
    const before = await read(queries)
    await client.query('SAVEPOINT missing_projection_case')
    try {
      const event = randomUUID()
      await client.query(
        `INSERT INTO outbox_events
           (id, event_type, event_version, payload, organization_id, property_id,
            source_context, source_aggregate_id, created_at)
         VALUES ($1::uuid, 'guest.qualified_scan.recorded', 1,
           jsonb_build_object('portalId', $2::text, 'portalGroupId', NULL,
             'occurredAt', '2026-08-05T10:00:00Z'),
           $3, $4, 'guest', $1::text, '2026-08-05T10:00:00Z')`,
        [event, subject.portalId, organization, property],
      )
      await client.query(
        `INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
         VALUES ($1, 'metric.guest-analytics', 'applied')`,
        [event],
      )
      const [missing, untouched] = await read(queries)
      expect(missing).toMatchObject({
        state: 'quarantined',
        reason: 'portal_attribution_mismatch',
      })
      expect(untouched).toEqual(before[1])

      await client.query(`UPDATE portals SET deleted_at = now() WHERE id = $1`, [
        subject.portalId,
      ])
      const [deleted] = await read([queries[0]!])
      expect(deleted).toMatchObject({
        state: 'unavailable',
        reason: 'subject_unavailable',
        exactValue: null,
      })
      const [wrongProperty] = await read([
        { ...queries[1]!, propertyId: propertyId(randomUUID()) },
      ])
      expect(wrongProperty).toMatchObject({
        state: 'unavailable',
        reason: 'subject_unavailable',
        exactValue: null,
      })
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT missing_projection_case')
    }
  })

  it('matches Portal subject authority for live, archived, missing and foreign subjects', async () => {
    if (!held) throw new Error('Progress fixture is unavailable')
    const { db, client } = held
    const groups = createPortalGroupPublicApi(createPortalGroupRepository(db), () => now)
    // This is the same named read exposed by Portal's public API.
    const portals = createPortalRepository(db)
    const registry = createMetricRegistryRepository()
    const single = queryGoalMetric({
      registry,
      clock: () => now,
      readSnapshot: createGoalMetricSnapshotReader(db),
      validateSubject: async (org, property, subject) => {
        if (subject.kind === 'property') return subject.propertyId === property
        if (subject.kind === 'portal_group')
          return groups.portalGroupBelongsToProperty(org, property, subject.portalGroupId)
        const context = await portals.resolvePortalContext(subject.portalId)
        return context?.organizationId === org && context.propertyId === property
      },
    })
    const batch = createGoalMetricBatchReader(db, registry, () => now)
    const first = bundles[0]!
    const base = subjectMonthQuery(
      first.version,
      first.assignments[0]!.subject,
      {
        start: new Date('2026-08-01T00:00:00Z'),
        end: new Date('2026-09-01T00:00:00Z'),
      },
      actor,
    )
    const subject = base.subject
    if (subject.kind !== 'portal') throw new Error('Expected a Portal goal')
    await client.query('SAVEPOINT subject_authority_parity')
    try {
      const otherOrg = organizationId(`other-${randomUUID()}`)
      const otherProperty = propertyId(randomUUID())
      const otherTenantProperty = propertyId(randomUUID())
      const group = portalGroupId(randomUUID())
      await client.query(
        `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Other', $1, now())`,
        [otherOrg],
      )
      await client.query(
        `INSERT INTO properties (id, organization_id, name, slug, timezone)
         VALUES ($1::uuid, $3, 'Other', $1::text, 'UTC'), ($2::uuid, $4, 'Other tenant', $2::text, 'UTC')`,
        [otherProperty, otherTenantProperty, organization, otherOrg],
      )
      await client.query(
        `INSERT INTO portal_groups (id, organization_id, property_id, name) VALUES ($1, $2, $3, 'Desk')`,
        [group, organization, property],
      )
      const cases = [
        base,
        {
          ...base,
          subject: { kind: 'portal' as const, portalId: portalId(randomUUID()) },
        },
        { ...base, propertyId: otherProperty },
        { ...base, subject: { kind: 'portal_group' as const, portalGroupId: group } },
        {
          ...base,
          propertyId: otherProperty,
          subject: { kind: 'portal_group' as const, portalGroupId: group },
        },
        {
          ...base,
          subject: {
            kind: 'portal_group' as const,
            portalGroupId: portalGroupId(randomUUID()),
          },
        },
        {
          ...base,
          subject: { kind: 'property' as const, propertyId: propertyId(property) },
        },
        { ...base, subject: { kind: 'property' as const, propertyId: otherProperty } },
      ]
      const assertParity = async () => {
        const expected = []
        for (const query of cases) expected.push(await single(query))
        const actual = await batch(cases)
        // Single reads additionally carry a source watermark; compare governed outcomes.
        expect(actual).toEqual(
          expected.map(({ sourceHead: _sourceHead, ...answer }) => answer),
        )
        const foreign = {
          ...base,
          organizationId: otherOrg,
          propertyId: otherTenantProperty,
        }
        const [denied] = await batch([foreign])
        const { sourceHead: _sourceHead, ...expectedDenial } = await single(foreign)
        expect(denied).toEqual(expectedDenial)
      }
      await assertParity()
      // Publication state does not erase a reachable Portal's metric history.
      for (const state of ['disabled', 'archived']) {
        await client.query('UPDATE portals SET publication_state = $1 WHERE id = $2', [
          state,
          subject.portalId,
        ])
        await assertParity()
      }
      await client.query('UPDATE portals SET deleted_at = $1 WHERE id = $2', [
        now,
        subject.portalId,
      ])
      await client.query('UPDATE portal_groups SET deleted_at = $1 WHERE id = $2', [
        now,
        group,
      ])
      await assertParity()
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT subject_authority_parity')
    }
  })
})
