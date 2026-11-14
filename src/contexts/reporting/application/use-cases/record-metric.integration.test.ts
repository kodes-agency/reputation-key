import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema/metric.schema'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  recordMetric,
  type RecordMetricDeps,
  type RecordMetricInput,
} from './record-metric'
import type {
  MetricSourceReceipt,
  RecordMetricsCommand,
} from '../ports/metric-command-store.port'
import type { GovernedMetricVersion } from '../../readings/contracts'
import { createAtomicMetricCommandStore } from '../../readings/metric-command-store.server'
import {
  metricReadingId,
  organizationId,
  portalId,
  portalGroupId,
  propertyId,
} from '#/shared/domain/ids'

const db = getDb()
const NOW = new Date('2026-08-08T12:00:00Z')
const ORG = organizationId('org-record-metric-use-case')
const PROPERTY = propertyId('d4000000-0000-4000-8000-000000000051')
const GROUP = portalGroupId('d4000000-0000-4000-8000-000000000061')
const LINK_PORTAL = portalId('10000000-0000-4000-8000-000000000001')
const RATING_PORTAL = portalId('d4000000-0000-4000-8000-000000000081')
const EVENT = 'd4000000-0000-4000-8000-0000000000e1'
const OTHER_EVENT = 'd4000000-0000-4000-8000-0000000000e2'

const governed: GovernedMetricVersion = {
  definition: {
    id: 'definition-1',
    key: 'portal.content_review.completed',
    valueKind: 'counter',
    workerDataFlag: false,
    privacyClass: 'operational',
    retentionClass: 'standard',
    lifecycleStatus: 'approved',
  },
  version: {
    id: '11111111-1111-4111-8111-111111111101',
    definitionId: 'definition-1',
    version: 1,
    effectiveFrom: new Date('2026-08-08T00:00:00Z'),
    effectiveTo: null,
    unit: 'review',
    precision: 0,
    allowedScopes: ['property', 'portal_group'],
    minimumSample: 1,
    insufficientDataBehavior: 'unavailable',
    sourcePolicyAllowlist: ['first_party_workflow'],
    permittedConsumers: ['dashboard', 'goal', 'notification'],
    employmentDecisionEligible: false,
  },
}

const input = (overrides: Partial<RecordMetricInput> = {}): RecordMetricInput => ({
  organizationId: ORG,
  propertyId: PROPERTY,
  portalId: null,
  portalGroupId: GROUP,
  definitionVersionId: governed.version.id,
  sourceEventId: EVENT,
  sourcePolicy: 'first_party_workflow',
  scope: 'portal_group',
  value: 1,
  sampleCount: 1,
  occurredAt: NOW,
  attributionQuality: 'exact',
  ...overrides,
})

const readReadings = () =>
  db.select().from(metricReadings).where(eq(metricReadings.organizationId, ORG))

const readReceipts = async (): Promise<MetricSourceReceipt[]> => {
  const { rows } = await db.execute<{ event_id: string; consumer_name: string }>(sql`
    SELECT event_id, consumer_name FROM event_consumer_receipts
    WHERE event_id IN (${EVENT}::uuid, ${OTHER_EVENT}::uuid)
  `)
  return rows.map((row) => ({ eventId: row.event_id, consumerName: row.consumer_name }))
}

const clean = async () => {
  await db.execute(sql`DELETE FROM metric_readings WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
}

const insertOutbox = (eventId: string) =>
  db.execute(sql`
    INSERT INTO outbox_events (
      id, event_type, event_version, payload, organization_id, property_id,
      source_context, source_aggregate_id
    ) VALUES (
      ${eventId}::uuid, 'portal.approved_destination_ratio.recorded', 1, '{}'::jsonb,
      ${ORG}, ${PROPERTY}, 'portal', ${LINK_PORTAL}
    )
  `)

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Record Metric Use Case', ${ORG}, now())
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${PROPERTY}, ${ORG}, 'Record Metric Property', 'record-metric-property', 'UTC')
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO portal_groups (id, organization_id, property_id, name)
    VALUES (${GROUP}, ${ORG}, ${PROPERTY}, 'Record Metric Group')
    ON CONFLICT (id) DO NOTHING
  `)
  for (const [id, slug] of [
    [LINK_PORTAL, 'record-metric-link-portal'],
    [RATING_PORTAL, 'record-metric-rating-portal'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO portals (
        id, organization_id, property_id, entity_type, entity_id, name, slug,
        publication_state
      ) VALUES (${id}, ${ORG}, ${PROPERTY}, 'property', ${PROPERTY}, ${slug}, ${slug}, 'published')
      ON CONFLICT (id) DO NOTHING
    `)
  }
})

beforeEach(async () => {
  await clean()
  await insertOutbox(EVENT)
  await insertOutbox(OTHER_EVENT)
})

afterAll(async () => {
  await clean()
  await db.execute(sql`DELETE FROM portals WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM portal_groups WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY}`)
  await deleteTestOrganizations(db, [ORG])
})

const createDeps = (version: GovernedMetricVersion | null = governed) => {
  const commands: RecordMetricsCommand[] = []
  const commandStore = createAtomicMetricCommandStore(db, randomUUID)
  const deps: RecordMetricDeps = {
    commandStore: {
      ...commandStore,
      recordMetrics: async (command) => {
        commands.push(command)
        return commandStore.recordMetrics(command)
      },
    },
    registry: { findVersionById: async () => version },
    clock: () => NOW,
    idGen: () => metricReadingId('d4000000-0000-4000-8000-000000000071'),
    resolvePropertyLocalDate: async () => '2026-08-08',
  }
  return { deps, commands }
}

describe('recordMetric', () => {
  it('records a versioned reading without an unconsumed outbox fact', async () => {
    const fakes = createDeps()
    const result = await recordMetric(fakes.deps)(input())

    expect(result.status).toBe('recorded')
    const readings = await readReadings()
    expect(readings).toHaveLength(1)
    expect(readings[0]).toMatchObject({
      definitionVersionId: governed.version.id,
      metricKey: 'portal.content_review.completed',
      sourceEventId: EVENT,
      sourcePolicy: 'first_party_workflow',
      groupId: GROUP,
      propertyLocalDate: '2026-08-08',
    })
    expect(fakes.commands[0]?.readings[0]).not.toHaveProperty('event')
  })

  it.each([
    [
      'secondary_link',
      '10000000-0000-4000-8000-000000000006',
      '10000000-0000-4000-8000-000000000006',
    ],
    ['google_review', 'google-review:portal-1', null],
    ['secondary_link', 'legacy-link', null],
  ] as const)(
    'records %s / %s with safe link attribution',
    async (destinationKind, portalLinkId, expected) => {
      const version: GovernedMetricVersion = {
        definition: { ...governed.definition, key: 'portal.review_link_click' },
        version: { ...governed.version, allowedScopes: ['portal'] },
      }
      const fakes = createDeps(version)
      const result = await recordMetric(fakes.deps)(
        input({
          portalId: LINK_PORTAL,
          scope: 'portal',
          destinationKind,
          portalLinkId,
        }),
      )
      expect(result.status).toBe('recorded')
      expect((await readReadings())[0]?.portalLinkId).toBe(expected)
    },
  )

  it('passes Portal destination metadata with a validated reading', async () => {
    const rating: GovernedMetricVersion = {
      definition: {
        ...governed.definition,
        key: 'portal.rating',
        valueKind: 'level',
        privacyClass: 'guest_private_analytics',
      },
      version: {
        ...governed.version,
        id: '11111111-1111-4111-8111-111111111202',
        allowedScopes: ['portal'],
        sourcePolicyAllowlist: ['first_party_guest_private'],
        permittedConsumers: ['dashboard', 'portal_analytics'],
      },
    }
    const fakes = createDeps(rating)
    let destination: unknown = 'not-called'
    const deps: RecordMetricDeps = {
      ...fakes.deps,
      commandStore: {
        ...fakes.deps.commandStore,
        recordMetrics: async (command) => {
          const [entry] = command.readings
          destination = entry?.destinationKind
          return entry ? [{ status: 'recorded', reading: entry.reading }] : []
        },
      },
    }

    await recordMetric(deps)(
      input({
        portalId: RATING_PORTAL,
        portalGroupId: null,
        definitionVersionId: rating.version.id,
        sourcePolicy: 'first_party_guest_private',
        scope: 'portal',
        value: 4,
      }),
    )

    expect(destination).toBeNull()
  })

  it('rejects an unknown immutable version without recording a fact', async () => {
    const fakes = createDeps(null)
    const result = await recordMetric(fakes.deps)(input())

    expect(result).toEqual({
      status: 'rejected',
      reason: 'unknown_definition_version',
      sourceEventId: EVENT,
    })
    expect(await readReadings()).toEqual([])
    expect(fakes.commands).toEqual([])
  })

  it.each([
    ['source_policy_not_allowed', { sourcePolicy: 'google_property_derivative' }],
    ['scope_not_allowed', { scope: 'portal' }],
    ['unresolved_attribution', { attributionQuality: 'unresolved' }],
  ] as const)('rejects %s readings', async (reason, overrides) => {
    const fakes = createDeps()
    const result = await recordMetric(fakes.deps)(input(overrides))

    expect(result).toMatchObject({ status: 'rejected', reason })
    expect(await readReadings()).toEqual([])
  })

  it('reports insufficient ratio data without persisting a misleading zero', async () => {
    const ratio: GovernedMetricVersion = {
      definition: {
        ...governed.definition,
        key: 'portal.approved_destination_ratio',
        valueKind: 'ratio',
      },
      version: {
        ...governed.version,
        id: '11111111-1111-4111-8111-111111111103',
        minimumSample: 5,
      },
    }
    const fakes = createDeps(ratio)
    const result = await recordMetric(fakes.deps)(
      input({
        definitionVersionId: ratio.version.id,
        value: 0.5,
        numerator: 1,
        denominator: 2,
        sampleCount: 2,
      }),
    )

    expect(result).toEqual({
      status: 'insufficient_data',
      definitionVersionId: ratio.version.id,
      minimumSample: 5,
      actualSample: 2,
    })
    expect(await readReadings()).toEqual([])
  })

  it('commits no receipt when a refused fact carries none', async () => {
    const fakes = createDeps()

    await recordMetric(fakes.deps)(input({ attributionQuality: 'unresolved' }))

    expect(await readReceipts()).toEqual([])
  })
})

describe('recordMetric for a durable delivery that yields no reading', () => {
  const receipt: MetricSourceReceipt = {
    eventId: EVENT,
    consumerName: 'metric.portal-workflow',
  }
  const ratio: GovernedMetricVersion = {
    definition: {
      ...governed.definition,
      key: 'portal.approved_destination_ratio',
      valueKind: 'ratio',
    },
    version: {
      ...governed.version,
      id: '11111111-1111-4111-8111-111111111103',
      minimumSample: 5,
    },
  }

  it('settles the delivery of a ratio under its minimum sample', async () => {
    const fakes = createDeps(ratio)

    const result = await recordMetric(fakes.deps)(
      input({
        definitionVersionId: ratio.version.id,
        value: 0.5,
        numerator: 1,
        denominator: 2,
        sampleCount: 2,
        sourceReceipt: receipt,
      }),
    )

    expect(result.status).toBe('insufficient_data')
    expect(await readReceipts()).toEqual([receipt])
    expect(await readReadings()).toEqual([])
  })

  it.each([
    ['unresolved_attribution', { attributionQuality: 'unresolved' }],
    ['invalid_reading', { value: -1 }],
    [
      'definition_version_not_effective',
      { occurredAt: new Date('2026-08-01T00:00:00Z') },
    ],
  ] as const)(
    'settles the delivery of a fact refused as %s',
    async (reason, overrides) => {
      const fakes = createDeps()

      const result = await recordMetric(fakes.deps)(
        input({ ...overrides, sourceReceipt: receipt }),
      )

      expect(result).toMatchObject({ status: 'rejected', reason })
      expect(await readReceipts()).toEqual([receipt])
      expect(await readReadings()).toEqual([])
    },
  )

  it.each([
    ['source_policy_not_allowed', { sourcePolicy: 'google_property_derivative' }],
    ['scope_not_allowed', { scope: 'portal' }],
  ] as const)(
    'fails the delivery of a fact the governance configuration refuses (%s), so a fix can replay it',
    async (reason, overrides) => {
      const fakes = createDeps()

      await expect(
        recordMetric(fakes.deps)(input({ ...overrides, sourceReceipt: receipt })),
      ).rejects.toThrow(`Metric reading was refused by governance: ${reason}`)

      expect(await readReceipts()).toEqual([])
    },
  )

  it('fails the delivery of a fact whose version the registry does not know', async () => {
    const fakes = createDeps(null)

    await expect(
      recordMetric(fakes.deps)(input({ sourceReceipt: receipt })),
    ).rejects.toThrow(
      'Metric reading was refused by governance: unknown_definition_version',
    )
    expect(await readReceipts()).toEqual([])
  })

  it('refuses a receipt that names another fact than the one it settles', async () => {
    const fakes = createDeps()

    await expect(
      recordMetric(fakes.deps)(
        input({
          attributionQuality: 'unresolved',
          sourceReceipt: { ...receipt, eventId: OTHER_EVENT },
        }),
      ),
    ).rejects.toThrow('Metric source receipt event does not match its reading')
    expect(await readReceipts()).toEqual([])
  })
})
