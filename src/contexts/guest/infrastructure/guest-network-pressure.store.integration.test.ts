import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { organizationId } from '#/shared/domain/ids'
import {
  RETENTION_RULES,
  createRetentionSweepHandler,
} from '#/shared/jobs/retention-sweep.job'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createGuestNetworkPressureStore } from './guest-network-pressure.store'

const ORG_A = organizationId('org-guest-network-pressure-a')
const ORG_B = organizationId('org-guest-network-pressure-b')
const PROPERTY_A = '82000000-0000-4000-8000-000000000010'
const PROPERTY_B = '82000000-0000-4000-8000-000000000020'
const PORTAL_A = '82000000-0000-4000-8000-000000000011'
const PORTAL_B = '82000000-0000-4000-8000-000000000021'
const PSEUDONYM = 'a'.repeat(64)
const OBSERVED_AT = new Date('2090-01-01T12:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  maxConnections: 10,
  tables: ['guest_network_pressure_records', 'portals', 'properties'],
})

beforeEach(async () => {
  await getPool().query('DELETE FROM retention_runs WHERE subject = $1', [
    'guest_network_pressure_records.expired',
  ])
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Network A', 'network-pressure-a', 'UTC'),
            ($3, $4, 'Network B', 'network-pressure-b', 'UTC')`,
    [PROPERTY_A, ORG_A, PROPERTY_B, ORG_B],
  )
  await getPool().query(
    `INSERT INTO portals (
       id, organization_id, property_id, entity_type, entity_id, name, slug,
       publication_state
     ) VALUES
       ($1, $2, $3, 'property', $7, 'Portal A', 'network-a', 'published'),
       ($4, $5, $6, 'property', $8, 'Portal B', 'network-b', 'published')`,
    [PORTAL_A, ORG_A, PROPERTY_A, PORTAL_B, ORG_B, PROPERTY_B, PROPERTY_A, PROPERTY_B],
  )
})

const input = (overrides: Record<string, unknown> = {}) => ({
  organizationId: ORG_A,
  propertyId: PROPERTY_A,
  portalId: PORTAL_A,
  pseudonym: PSEUDONYM,
  action: 'rating' as const,
  observedAt: OBSERVED_AT,
  maxRequests: 3,
  windowSeconds: 60 * 60,
  ...overrides,
})

describe.sequential('canonical Guest network-pressure authority (PostgreSQL)', () => {
  it('atomically admits only the configured number of concurrent Portal-scoped actions', async () => {
    const store = createGuestNetworkPressureStore(getDb(), randomUUID)

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => store.consume(input())),
    )

    expect(outcomes.filter(({ allowed }) => allowed)).toHaveLength(3)
    expect(outcomes.filter(({ allowed }) => !allowed)).toHaveLength(5)
    expect(outcomes.find(({ allowed }) => !allowed)).toMatchObject({
      remaining: 0,
      resetAt: new Date('2090-01-01T13:00:00.000Z'),
    })
    await expect(
      getPool().query(
        `SELECT count(*)::int count FROM guest_network_pressure_records
         WHERE organization_id = $1 AND portal_id = $2`,
        [ORG_A, PORTAL_A],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 3 }] })
  })

  it('uses a half-open pressure window and never lets another tenant or Portal contribute', async () => {
    const store = createGuestNetworkPressureStore(getDb(), randomUUID)
    await expect(store.consume(input({ maxRequests: 1 }))).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    })
    await expect(
      store.consume(
        input({
          organizationId: ORG_B,
          propertyId: PROPERTY_B,
          portalId: PORTAL_B,
          maxRequests: 1,
        }),
      ),
    ).resolves.toMatchObject({ allowed: true })
    await expect(
      store.consume(
        input({
          observedAt: new Date('2090-01-01T13:00:00.000Z'),
          maxRequests: 1,
        }),
      ),
    ).resolves.toMatchObject({ allowed: true })
  })

  it('stores no session, destination, source-fact, content, or staff identity columns', async () => {
    const columns = await getPool().query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'guest_network_pressure_records'
       ORDER BY ordinal_position`,
    )

    expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
      'id',
      'organization_id',
      'property_id',
      'portal_id',
      'pseudonym',
      'action',
      'observed_at',
      'expires_at',
    ])
  })

  it('deletes expired records in bounded, restart-safe runs with content-free evidence', async () => {
    const store = createGuestNetworkPressureStore(getDb(), randomUUID)
    await store.consume(input())
    await store.consume(input({ action: 'private_feedback' }))

    const rule = RETENTION_RULES.find(
      ({ subject }) => subject === 'guest_network_pressure_records.expired',
    )
    expect(rule).toEqual({
      subject: 'guest_network_pressure_records.expired',
      table: 'guest_network_pressure_records',
      keyColumns: ['id'],
      tsColumn: 'expires_at',
      olderThanMs: 0,
    })

    const sweepAt = new Date('2090-01-08T12:00:00.001Z')
    const handler = createRetentionSweepHandler({
      db: getDb(),
      clock: () => sweepAt,
      rules: [rule!],
      batchSize: 1,
    })
    await handler({} as never)
    await handler({} as never)

    await expect(
      getPool().query(
        `SELECT count(*)::int count FROM guest_network_pressure_records
         WHERE organization_id = $1`,
        [ORG_A],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] })
    await expect(
      getPool().query(
        `SELECT rows_deleted, rows_redacted, outcome
         FROM retention_runs
         WHERE subject = 'guest_network_pressure_records.expired'
           AND started_at = $1
         ORDER BY id DESC
         LIMIT 2`,
        [sweepAt],
      ),
    ).resolves.toMatchObject({
      rows: expect.arrayContaining([
        { rows_deleted: 2, rows_redacted: 0, outcome: 'completed' },
        { rows_deleted: 0, rows_redacted: 0, outcome: 'completed' },
      ]),
    })
  })
})
