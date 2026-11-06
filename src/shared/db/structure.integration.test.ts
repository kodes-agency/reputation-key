import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { ensureTestDatabase } from '#/shared/testing/test-db-setup'
import {
  acquireTestLease,
  type TestLease,
  validateTestDatabaseUrl,
} from '#/shared/testing/test-environment-lease'
import { checkStructure, readStructure } from './structure.server'
import { buildRegisteredConcurrentIndexes } from './concurrent-index-sidecar'

describe('committed PostgreSQL structure authority', () => {
  let lease: TestLease
  let databaseUrl: string
  const snapshot = () => readFileSync(new URL('./structure.sql', import.meta.url), 'utf8')

  beforeAll(async () => {
    databaseUrl = getEnv().DATABASE_URL
    lease = await acquireTestLease(databaseUrl)
  })
  afterAll(async () => {
    await lease?.release()
  })

  async function detectsDrift(change: string, restore: string) {
    expect(await checkStructure(databaseUrl)).toEqual([])
    try {
      // pg_dump uses another session, so rollback-only DDL cannot exercise the gate.
      await lease.pool.query(change)
      expect(await readStructure(databaseUrl)).not.toBe(snapshot())
      expect((await checkStructure(databaseUrl)).length).toBeGreaterThan(0)
    } finally {
      await lease.pool.query(restore)
    }
    expect(await readStructure(databaseUrl)).toBe(snapshot())
    expect(await checkStructure(databaseUrl)).toEqual([])
  }

  it('matches the committed dump after the CI migration sequence', async () => {
    expect(await readStructure(databaseUrl)).toBe(snapshot())
    expect(await readStructure(databaseUrl)).toBe(snapshot())
    expect(await checkStructure(databaseUrl)).toEqual([])
  })

  it('builds the same structure from an explicitly empty disposable database', async () => {
    const database = `test_structure_${randomUUID().replaceAll('-', '')}`
    const target = new URL(databaseUrl)
    target.pathname = `/${database}`
    const url = target.toString()
    validateTestDatabaseUrl(url)
    await lease.pool.query(`CREATE DATABASE "${database}" TEMPLATE template0`)
    try {
      expect((await ensureTestDatabase(url)).migrated).toBe(true)
      const freshLease = await acquireTestLease(url)
      try {
        const client = await freshLease.pool.connect()
        try {
          // Registered indexes are still a separate part of the deploy path.
          const indexes = await buildRegisteredConcurrentIndexes(client)
          expect(indexes.every(({ ok }) => ok)).toBe(true)
        } finally {
          client.release()
        }
      } finally {
        await freshLease.release()
      }
      expect(await readStructure(url)).toBe(snapshot())
      expect(await checkStructure(url)).toEqual([])
    } finally {
      await lease.pool.query(`DROP DATABASE "${database}" WITH (FORCE)`)
    }
  }, 180_000)

  it('rejects an unexpected table', async () => {
    const table = `structure_fixture_${randomUUID().replaceAll('-', '')}`
    await detectsDrift(
      `CREATE TABLE public."${table}" (id integer PRIMARY KEY)`,
      `DROP TABLE IF EXISTS public."${table}"`,
    )
  })

  it('rejects a changed column default without changing feature rows', async () => {
    const { rows } = await lease.pool.query<{ definition: string }>(`
      SELECT pg_get_expr(d.adbin, d.adrelid) AS definition
      FROM pg_attrdef d JOIN pg_attribute a
        ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE d.adrelid = 'public.properties'::regclass AND a.attname = 'lifecycle_state'
    `)
    const original = rows[0]
    expect(original).toBeDefined()
    await detectsDrift(
      "ALTER TABLE public.properties ALTER COLUMN lifecycle_state SET DEFAULT 'structure_changed'",
      `ALTER TABLE public.properties ALTER COLUMN lifecycle_state SET DEFAULT ${original!.definition}`,
    )
  })

  it('rejects a changed CHECK expression', async () => {
    const { rows } = await lease.pool.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'public.ai_execution_control_heads'::regclass
        AND conname = 'ai_execution_control_heads_generation_valid'
    `)
    const original = rows[0]
    expect(original).toBeDefined()
    const drop = `ALTER TABLE public.ai_execution_control_heads
      DROP CONSTRAINT ai_execution_control_heads_generation_valid`
    const add = `ALTER TABLE public.ai_execution_control_heads
      ADD CONSTRAINT ai_execution_control_heads_generation_valid`
    await detectsDrift(
      `${drop}; ${add} CHECK (generation >= 0)`,
      `${drop}; ${add} ${original!.definition}`,
    )
  })

  it('rejects a changed index predicate', async () => {
    const { rows } = await lease.pool.query<{ name: string; definition: string }>(`
      SELECT i.indexrelid::regclass::text AS name,
        pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND NOT i.indisunique
        AND i.indisvalid AND i.indpred IS NOT NULL
      ORDER BY i.indexrelid::regclass::text LIMIT 1
    `)
    const original = rows[0]
    expect(original).toBeDefined()
    const drop = `DROP INDEX ${original!.name}`
    const changed = original!.definition.replace(/\sWHERE[\s\S]*$/, ' WHERE false')
    expect(changed).not.toBe(original!.definition)
    await detectsDrift(`${drop}; ${changed}`, `${drop}; ${original!.definition}`)
  })

  it('rejects a changed foreign-key delete action', async () => {
    const { rows } = await lease.pool.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'public.reviews'::regclass
        AND conname = 'reviews_property_tenant_fk'
    `)
    const original = rows[0]
    expect(original).toBeDefined()
    const changed = original!.definition.replace(
      'ON DELETE CASCADE',
      'ON DELETE RESTRICT',
    )
    expect(changed).not.toBe(original!.definition)
    const drop = 'ALTER TABLE public.reviews DROP CONSTRAINT reviews_property_tenant_fk'
    const add = 'ALTER TABLE public.reviews ADD CONSTRAINT reviews_property_tenant_fk'
    await detectsDrift(
      `${drop}; ${add} ${changed}`,
      `${drop}; ${add} ${original!.definition}`,
    )
  })

  it('rejects an enum label change while preserving stored values', async () => {
    await detectsDrift(
      "ALTER TYPE public.inbox_status RENAME VALUE 'open' TO 'structure_changed'",
      "ALTER TYPE public.inbox_status RENAME VALUE 'structure_changed' TO 'open'",
    )
  })

  it('rejects a function attribute change', async () => {
    const { rows } = await lease.pool.query<{
      signature: string
      definition: string
      volatility: string
    }>(`
      SELECT p.oid::regprocedure::text AS signature, pg_get_functiondef(p.oid) AS definition,
        p.provolatile AS volatility FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
      ORDER BY p.oid::regprocedure::text LIMIT 1
    `)
    const original = rows[0]
    expect(original).toBeDefined()
    await detectsDrift(
      `ALTER FUNCTION ${original!.signature} ${original!.volatility === 'v' ? 'STABLE' : 'VOLATILE'}`,
      original!.definition,
    )
  })

  it('rejects a modified applied migration hash even when the schema still matches', async () => {
    const { rows } = await lease.pool.query<{ id: number; hash: string }>(
      'SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY created_at LIMIT 1',
    )
    const original = rows[0]
    expect(original).toBeDefined()
    expect(await checkStructure(databaseUrl)).toEqual([])
    try {
      await lease.pool.query(
        'UPDATE drizzle.__drizzle_migrations SET hash = $1 WHERE id = $2',
        ['0'.repeat(64), original!.id],
      )
      expect(await readStructure(databaseUrl)).toBe(snapshot())
      expect((await checkStructure(databaseUrl)).length).toBeGreaterThan(0)
    } finally {
      await lease.pool.query(
        'UPDATE drizzle.__drizzle_migrations SET hash = $1 WHERE id = $2',
        [original!.hash, original!.id],
      )
    }
    expect(await checkStructure(databaseUrl)).toEqual([])
  })
})
