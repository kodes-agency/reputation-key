import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createResponseCeiling } from '../application/use-cases/response-ceiling.server'
import {
  createResponseCeilingStore,
  RESPONSE_PRESSURE_MARKERS,
} from './response-ceiling-store.server'
import { drizzleGuestLifecycleWorkbench } from './adapters/guest-organization-erasure'

const ORG = organizationId('org-response-ceiling-test')
const OTHER_ORG = organizationId('org-response-ceiling-other')
const SCOPE = {
  organizationId: ORG,
  propertyId: propertyId(randomUUID()),
  portalId: portalId(randomUUID()),
}
const SIBLING = { ...SCOPE, portalId: portalId(randomUUID()) }
const OTHER = {
  organizationId: OTHER_ORG,
  propertyId: propertyId(randomUUID()),
  portalId: portalId(randomUUID()),
}
const NOW = new Date('2090-01-01T12:00:00Z')
const SECRET = 'response-ceiling-test-secret'
const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  maxConnections: 10,
  tables: ['guest_network_pressure_records', 'portals', 'properties'],
})

beforeEach(async () => {
  for (const scope of [SCOPE, OTHER]) {
    await getPool().query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
      VALUES ($1::uuid, $2::text, 'Ceiling', $1::text, 'UTC')`,
      [scope.propertyId, scope.organizationId],
    )
  }
  for (const scope of [SCOPE, SIBLING, OTHER]) {
    await getPool().query(
      `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, publication_state)
      VALUES ($1::uuid, $2::text, $3::uuid, 'property', $3::text, 'Ceiling', $1::text, 'published')`,
      [scope.portalId, scope.organizationId, scope.propertyId],
    )
  }
})

const logger = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
}
const ceiling = (limit?: number, now = NOW) =>
  createResponseCeiling({
    store: createResponseCeilingStore(getDb(), SECRET),
    clock: () => now,
    logger,
    organizationDailyLimit: limit,
  })

async function seed(count: number, observedAt: Date, scope = SCOPE) {
  await getPool().query(
    `INSERT INTO guest_network_pressure_records
    (id, organization_id, property_id, portal_id, pseudonym, action, observed_at, expires_at)
    SELECT gen_random_uuid(), $1, $2, $3, $4, 'rating', $5::timestamptz,
      $5::timestamptz + interval '7 days'
    FROM generate_series(1, $6::int)`,
    [
      scope.organizationId,
      scope.propertyId,
      scope.portalId,
      RESPONSE_PRESSURE_MARKERS.admitted,
      observedAt,
      count,
    ],
  )
}

describe.sequential('shared response admission in PostgreSQL', () => {
  it.each([
    ['portal hour', 299, NOW, SCOPE],
    ['portal day', 1999, new Date('2090-01-01T10:00:00Z'), SCOPE],
    ['organization day', 4999, NOW, SIBLING],
  ] as const)(
    'serializes the last %s slot and concurrent retries',
    async (_window, count, at, seedScope) => {
      await seed(count, at, seedScope)
      const service = ceiling()
      const sessions = Array.from({ length: 10 }, () => randomUUID())
      const results = await Promise.all(
        sessions.map((session) => service.reserve(SCOPE, session)),
      )
      expect(results.filter(({ allowed }) => allowed)).toHaveLength(1)
      const winner = sessions[results.findIndex(({ allowed }) => allowed)]!
      expect(
        (
          await Promise.all(
            Array.from({ length: 10 }, () => service.reserve(SCOPE, winner)),
          )
        ).every(({ allowed }) => allowed),
      ).toBe(true)
      const records = await getPool().query(
        `SELECT * FROM guest_network_pressure_records
      WHERE organization_id = $1 AND pseudonym IN ($2, $3)`,
        [ORG, RESPONSE_PRESSURE_MARKERS.admitted, RESPONSE_PRESSURE_MARKERS.dropped],
      )
      expect(records.rows).toHaveLength(count + sessions.length)
      expect(records.rows.every((row) => !('rating' in row) && !('text' in row))).toBe(
        true,
      )
      expect(JSON.stringify(records.rows)).not.toContain(sessions[0])
      const responses = await getPool().query(
        'SELECT count(*)::int total FROM guest_responses WHERE organization_id = $1',
        [ORG],
      )
      expect(responses.rows).toEqual([{ total: 0 }])
      const alerts = await getPool().query(
        `SELECT count(*)::int total FROM guest_network_pressure_records
      WHERE organization_id = $1 AND pseudonym = $2`,
        [ORG, RESPONSE_PRESSURE_MARKERS.alert],
      )
      expect(alerts.rows).toEqual([{ total: 1 }])
    },
  )

  it('shares an organization override across Portals while isolating another Organization', async () => {
    const service = ceiling(1)
    await expect(service.reserve(SCOPE, randomUUID())).resolves.toMatchObject({
      allowed: true,
    })
    await expect(service.reserve(SIBLING, randomUUID())).resolves.toMatchObject({
      allowed: false,
    })
    await expect(service.reserve(OTHER, randomUUID())).resolves.toMatchObject({
      allowed: true,
    })
  })

  it('ignores previous-day and future-day reservations at an exact UTC boundary', async () => {
    await seed(300, new Date('2089-12-31T23:59:59.999Z'))
    await seed(300, new Date('2090-01-02T00:00:00Z'))
    await expect(
      ceiling(undefined, new Date('2090-01-01T00:00:00Z')).reserve(SCOPE, randomUUID()),
    ).resolves.toMatchObject({ allowed: true })
  })

  it('uses the existing Organization count and erase paths for all reservation metadata', async () => {
    const service = ceiling(1)
    await service.reserve(SCOPE, randomUUID())
    await service.reserve(SCOPE, randomUUID())
    await getDb().transaction(async (tx) => {
      expect(await drizzleGuestLifecycleWorkbench.countTenantRows(tx, ORG)).toBe(3)
      await drizzleGuestLifecycleWorkbench.scrubTenantRows(tx, ORG)
      expect(await drizzleGuestLifecycleWorkbench.countTenantRows(tx, ORG)).toBe(0)
    })
  })
})
