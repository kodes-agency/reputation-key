import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { contractionCandidateTableNames } from '#/shared/governance/contraction-inventory-registry'
import { scanNonFkReferences } from './non-fk-reference-scanner.repository'

let lease: TestLease
let db: Database

const CANDIDATES = contractionCandidateTableNames()
const AS_OF = new Date('2026-08-28T00:00:00.000Z')

const ORGANIZATION = `org-non-fk-${randomUUID().slice(0, 8)}`
const PROPERTY_ID = randomUUID()
const PORTAL_ID = randomUUID()
const RATING_ID = randomUUID()

type TransactionConfig = Readonly<{ isolationLevel?: string; accessMode?: string }>

function observedDatabase(target: Database, configs: TransactionConfig[]): Database {
  return new Proxy(target, {
    get(source, property, receiver) {
      if (property !== 'transaction') return Reflect.get(source, property, receiver)
      return (operation: unknown, config?: TransactionConfig) => {
        configs.push(config ?? {})
        return (
          source.transaction as unknown as (
            operation: unknown,
            config?: TransactionConfig,
          ) => unknown
        )(operation, config)
      }
    },
  }) as Database
}

const countFor = (
  report: Awaited<ReturnType<typeof scanNonFkReferences>>,
  surfaceId: string,
): number =>
  report.tables[0]?.probes.find((probe) => probe.surfaceId === surfaceId)
    ?.referenceCount ?? -1

/**
 * The tenant fixture stays for the whole suite; only the rows that carry a
 * non-FK reference are seeded and removed, so the before/after deltas isolate
 * exactly what the scanner is supposed to see.
 */
async function seedTenant(): Promise<void> {
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORGANIZATION}, 'Non-FK Reference Scan', ${ORGANIZATION}, NOW())
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
    VALUES (${PROPERTY_ID}, ${ORGANIZATION}, 'Non-FK Property', ${ORGANIZATION}, 'UTC', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO portals
      (id, organization_id, property_id, entity_type, entity_id, name, slug,
       created_at, updated_at)
    VALUES (
      ${PORTAL_ID}, ${ORGANIZATION}, ${PROPERTY_ID}, 'property', ${PROPERTY_ID},
      'Non-FK Portal', ${PORTAL_ID}, NOW(), NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `)
}

async function seedReferences(): Promise<void> {
  await db.execute(sql`
    INSERT INTO ratings (id, organization_id, portal_id, property_id, value, source)
    VALUES (${RATING_ID}, ${ORGANIZATION}, ${PORTAL_ID}, ${PROPERTY_ID}, 5, 'widget')
  `)
  await db.execute(sql`
    INSERT INTO recent_activity_entries
      (actor_id, actor_name, actor_role, action, resource_type, resource_id, organization_id, payload)
    VALUES (
      'actor-non-fk', 'Actor', 'owner', 'changed', 'review', ${RATING_ID},
      ${ORGANIZATION}, jsonb_build_object('ratingId', ${RATING_ID}::text)
    )
  `)
  await db.execute(sql`
    INSERT INTO outbox_events
      (event_type, payload, organization_id, source_context, source_aggregate_id)
    VALUES (
      'guest.rating.submitted',
      jsonb_build_object('ratingId', ${RATING_ID}::text),
      ${ORGANIZATION},
      'guest',
      ${RATING_ID}
    )
  `)
}

async function removeReferences(): Promise<void> {
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORGANIZATION}`)
  await db.execute(
    sql`DELETE FROM recent_activity_entries WHERE organization_id = ${ORGANIZATION}`,
  )
  await db.execute(sql`DELETE FROM ratings WHERE organization_id = ${ORGANIZATION}`)
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
  await seedTenant()
})

afterAll(async () => {
  if (db) {
    await removeReferences()
    await db.execute(sql`DELETE FROM portals WHERE id = ${PORTAL_ID}`)
    await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY_ID}`)
    await deleteTestOrganizations(lease.pool, [ORGANIZATION])
  }
  await lease.release()
})

describe('non-FK reference scanner (real PostgreSQL)', () => {
  it('counts textual and jsonb referents, and returns to zero when they are gone', async () => {
    const configs: TransactionConfig[] = []
    const observed = observedDatabase(db, configs)
    const scan = () =>
      scanNonFkReferences(observed, {
        evaluatedAt: AS_OF,
        referentTables: ['ratings'],
        candidateTables: CANDIDATES,
      })

    const before = await scan()
    await seedReferences()
    const after = await scan()

    // The activity and outbox documents embed the rating id, while the outbox
    // row also carries it as a textual aggregate id. None is a foreign key.
    expect(
      countFor(after, 'recent_activity_entries.payload') -
        countFor(before, 'recent_activity_entries.payload'),
    ).toBe(1)
    expect(
      countFor(after, 'outbox_events.payload') -
        countFor(before, 'outbox_events.payload'),
    ).toBe(1)
    expect(
      countFor(after, 'outbox_events.source_aggregate_id') -
        countFor(before, 'outbox_events.source_aggregate_id'),
    ).toBe(1)
    expect(after.totalReferences).toBeGreaterThan(before.totalReferences)
    expect(after.blockers).toEqual(['non_fk_references_require_disposition'])

    await removeReferences()
    const cleaned = await scan()
    expect(cleaned.tables[0]?.probes).toEqual(before.tables[0]?.probes)
    expect(cleaned.totalReferences).toBe(before.totalReferences)

    // Deterministic: same observation time, same data, same fingerprint.
    expect(cleaned.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(cleaned.fingerprint).toBe(before.fingerprint)
    expect(after.fingerprint).not.toBe(before.fingerprint)
    expect(cleaned.evaluatedAt).toBe('2026-08-28T00:00:00.000Z')

    expect(configs.length).toBeGreaterThanOrEqual(3)
    for (const config of configs) {
      expect(config).toEqual({
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      })
    }
  })

  it('emits counts and column identifiers only — never a referenced identifier', async () => {
    await seedReferences()
    try {
      const report = await scanNonFkReferences(db, {
        evaluatedAt: AS_OF,
        referentTables: ['ratings'],
        candidateTables: CANDIDATES,
      })
      const serialized = JSON.stringify(report)

      expect(serialized).not.toContain(RATING_ID)
      expect(serialized).not.toContain(ORGANIZATION)
      expect(serialized).not.toContain(PROPERTY_ID)
      expect(serialized).toContain('payload')
      expect(
        report.tables[0]?.probes.every(({ referenceCount }) => referenceCount >= 0),
      ).toBe(true)
    } finally {
      await removeReferences()
    }
  })

  it('refuses to mutate: the scan runs inside a read-only transaction', async () => {
    await expect(
      db.transaction(
        async (snapshot) => {
          await snapshot.execute(
            sql`INSERT INTO ratings
                  (id, organization_id, portal_id, property_id, value, source)
                VALUES (
                  ${randomUUID()}, ${ORGANIZATION}, ${PORTAL_ID}, ${PROPERTY_ID}, 5, 'widget'
                )`,
          )
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),
      // Postgres 25006 by code, on the driver error Drizzle wraps: an unnamed
      // throw assertion would also pass for a typo in the INSERT, which would
      // then read as proof that the read-only fence holds.
    ).rejects.toMatchObject({ cause: { code: '25006' } })
  })
})
