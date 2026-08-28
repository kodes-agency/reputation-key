import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const AUTH_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'organization',
  'member',
  'invitation',
  'organizationRole',
] as const

const REGISTERED_POST_BOOTSTRAP_INDEXES = new Set([
  'organization_role_org_role_lower_unique',
])

const bootstrapSqlUrl = new URL(
  '../../../scripts/migrations/0000-auth-tables-bootstrap.sql',
  import.meta.url,
)

function normalizeCatalogText(value: string, schemas: readonly string[]): string {
  let normalized = value
  for (const schema of schemas) {
    normalized = normalized.replaceAll(`"${schema}".`, '').replaceAll(`${schema}.`, '')
  }
  return normalized.replaceAll(/\s+/g, ' ').trim()
}

async function columnSignature(
  client: PoolClient,
  schema: string,
): Promise<readonly string[]> {
  const result = await client.query<
    QueryResultRow & {
      table_name: string
      column_name: string
      ordinal_position: number
      data_type: string
      udt_name: string
      is_nullable: string
      column_default: string | null
    }
  >(
    `SELECT table_name, column_name, ordinal_position, data_type, udt_name,
            is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = ANY($2::text[])
      ORDER BY table_name, ordinal_position`,
    [schema, AUTH_TABLES],
  )

  return result.rows.map((row) =>
    JSON.stringify({
      table: row.table_name,
      column: row.column_name,
      position: row.ordinal_position,
      dataType: row.data_type,
      udtName: row.udt_name,
      nullable: row.is_nullable,
      default: normalizeCatalogText(row.column_default ?? '', [schema, 'public']),
    }),
  )
}

async function constraintSignature(
  client: PoolClient,
  schema: string,
): Promise<readonly string[]> {
  const result = await client.query<
    QueryResultRow & {
      table_name: string
      constraint_type: string
      definition: string
    }
  >(
    `SELECT table_rel.relname AS table_name,
            constraint_row.contype::text AS constraint_type,
            pg_get_constraintdef(constraint_row.oid, true) AS definition
       FROM pg_constraint constraint_row
       JOIN pg_class table_rel ON table_rel.oid = constraint_row.conrelid
       JOIN pg_namespace table_ns ON table_ns.oid = table_rel.relnamespace
      WHERE table_ns.nspname = $1
        AND table_rel.relname = ANY($2::text[])
      ORDER BY table_rel.relname, constraint_row.contype,
               pg_get_constraintdef(constraint_row.oid, true)`,
    [schema, AUTH_TABLES],
  )

  return result.rows
    .map((row) =>
      JSON.stringify({
        table: row.table_name,
        type: row.constraint_type,
        definition: normalizeCatalogText(row.definition, [schema, 'public']),
      }),
    )
    .sort()
}

async function indexSignature(
  client: PoolClient,
  schema: string,
): Promise<readonly string[]> {
  const result = await client.query<
    QueryResultRow & {
      table_name: string
      index_name: string
      is_unique: boolean
      access_method: string
      keys: string[]
      predicate: string
    }
  >(
    `SELECT table_rel.relname AS table_name,
            index_rel.relname AS index_name,
            index_row.indisunique AS is_unique,
            access_method.amname AS access_method,
            ARRAY(
              SELECT pg_get_indexdef(index_row.indexrelid, key_position, true)
                FROM generate_series(1, index_row.indnkeyatts) key_position
               ORDER BY key_position
            ) AS keys,
            COALESCE(pg_get_expr(index_row.indpred, index_row.indrelid, true), '') AS predicate
       FROM pg_index index_row
       JOIN pg_class table_rel ON table_rel.oid = index_row.indrelid
       JOIN pg_namespace table_ns ON table_ns.oid = table_rel.relnamespace
       JOIN pg_class index_rel ON index_rel.oid = index_row.indexrelid
       JOIN pg_am access_method ON access_method.oid = index_rel.relam
      WHERE table_ns.nspname = $1
        AND table_rel.relname = ANY($2::text[])
      ORDER BY table_rel.relname, index_rel.relname`,
    [schema, AUTH_TABLES],
  )

  return result.rows
    .filter(
      (row) =>
        schema !== 'public' || !REGISTERED_POST_BOOTSTRAP_INDEXES.has(row.index_name),
    )
    .map((row) =>
      JSON.stringify({
        table: row.table_name,
        unique: row.is_unique,
        method: row.access_method,
        keys: row.keys.map((key) => normalizeCatalogText(key, [schema, 'public'])),
        predicate: normalizeCatalogText(row.predicate, [schema, 'public']),
      }),
    )
    .sort()
}

describe('Better Auth recovery bootstrap compatibility', () => {
  let lease: TestLease
  let client: PoolClient
  let compatibilitySchema: string

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    client = await lease.pool.connect()
    compatibilitySchema = `auth_bootstrap_${randomUUID().replaceAll('-', '')}`

    const bootstrapSql = await readFile(bootstrapSqlUrl, 'utf8')
    await client.query(`CREATE SCHEMA "${compatibilitySchema}"`)
    await client.query(`SET search_path TO "${compatibilitySchema}"`)
    await client.query(bootstrapSql)
  })

  afterAll(async () => {
    if (client) {
      await client.query('RESET search_path')
      if (compatibilitySchema) {
        await client.query(`DROP SCHEMA "${compatibilitySchema}" CASCADE`)
      }
      client.release()
    }
    await lease?.release()
  })

  it('matches runtime-created columns, constraints, and indexes', async () => {
    expect(await columnSignature(client, compatibilitySchema)).toEqual(
      await columnSignature(client, 'public'),
    )
    expect(await constraintSignature(client, compatibilitySchema)).toEqual(
      await constraintSignature(client, 'public'),
    )
    expect(await indexSignature(client, compatibilitySchema)).toEqual(
      await indexSignature(client, 'public'),
    )
  })
})
