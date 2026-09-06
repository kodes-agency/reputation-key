// Integration context — durable import discovery checkpoint persistence.
//
// durable-import-reference-store.integration.test.ts drives these statements
// against real PostgreSQL through the publisher and the reader; what is
// asserted here is the decision logic around them, which a database round-trip
// hides: the order the invalidation fence is applied in, the shape of the
// advisory-lock name, the collision verdict, and the expiry boundary.
// A fake `Database` records every statement the module issues and the
// predicates are rendered through the real PostgreSQL dialect, so a dropped
// audience binding or a flipped expiry comparison fails here rather than
// resolving one caller's handle against another caller's checkpoint.

import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  googleImportDiscoveryInvalidations,
  googleImportDiscoveryRecords,
} from '#/shared/db/schema/google-import-discovery.schema'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { ImportDiscoveryAuthorization } from '../application/ports/google-import-reference-store.port'
import {
  createDurableImportReferenceKeys,
  invalidationScopeFor,
} from './durable-import-reference-keys'
import {
  DurableImportReferenceCollision,
  DurableImportReferenceInvalidated,
  acquireDurableImportScopeLocks,
  durableImportReferenceExists,
  insertDurableImportRecords,
  loadDurableImportRecord,
  type DurableImportRecord,
} from './durable-import-reference-persistence'

const ORGANIZATION_ID = 'org-durable-persistence'
const USER_ID = 'user-durable-persistence'
const CONNECTION_ID = '83000000-0000-4000-8000-000000000001'
const REFERENCE_KEY = 'a'.repeat(43)
const ISSUED_AT = new Date('2026-08-28T10:00:00.000Z')
const EXPIRES_AT = new Date('2026-08-28T10:15:00.000Z')
const NOW = new Date('2026-08-28T10:05:00.000Z')

const keys = createDurableImportReferenceKeys({
  keys: createVersionedHmacKeyring(`v1:${'41'.repeat(32)}`),
})

const CONNECTION_SCOPE = invalidationScopeFor('connection', [
  ORGANIZATION_ID,
  CONNECTION_ID,
])

const AUTHORIZATION: ImportDiscoveryAuthorization = Object.freeze({
  organizationId: ORGANIZATION_ID,
  userId: USER_ID,
  connectionId: CONNECTION_ID,
  connectionLifecycleVersion: 3,
  connectionAccessVersion: 5,
  credentialGeneration: 7,
  authorizationVector: Object.freeze({ policyVersion: 11, permissionVersion: 13 }),
})

type Statement =
  | Readonly<{ op: 'execute'; query: SQL }>
  | Readonly<{ op: 'delete'; table: unknown; where: SQL }>
  | Readonly<{ op: 'select'; table: unknown; where: SQL; limit: number }>
  | Readonly<{
      op: 'insert'
      table: unknown
      values: readonly Readonly<Record<string, unknown>>[]
    }>

type FakeRows = Readonly<{
  /** Live fences returned by the invalidation probe. */
  invalidations?: readonly unknown[]
  /** Rows returned by a checkpoint read. */
  records?: readonly unknown[]
  /** Keys the insert reports as applied (defaults to every supplied row). */
  inserted?: readonly unknown[]
}>

const createFakeDatabase = (rows: FakeRows = {}) => {
  const statements: Statement[] = []
  const handle = {
    execute: async (query: SQL) => {
      statements.push({ op: 'execute', query })
      return { rows: [] }
    },
    delete: (table: unknown) => ({
      where: async (where: SQL) => {
        statements.push({ op: 'delete', table, where })
      },
    }),
    select: (_projection?: unknown) => ({
      from: (table: unknown) => ({
        where: (where: SQL) => ({
          limit: async (limit: number) => {
            statements.push({ op: 'select', table, where, limit })
            return table === googleImportDiscoveryInvalidations
              ? (rows.invalidations ?? [])
              : (rows.records ?? [])
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: readonly Readonly<Record<string, unknown>>[]) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            statements.push({ op: 'insert', table, values })
            return rows.inserted ?? values.map((value) => ({ key: value.referenceKey }))
          },
        }),
      }),
    }),
  }
  const db = {
    ...handle,
    transaction: async (operation: (tx: unknown) => Promise<unknown>) =>
      operation(handle),
  } as unknown as Database
  return { db, statements }
}

const only = <Kind extends Statement['op']>(
  statements: readonly Statement[],
  op: Kind,
  table?: unknown,
): readonly Extract<Statement, { op: Kind }>[] =>
  statements
    .filter(
      (statement): statement is Extract<Statement, { op: Kind }> => statement.op === op,
    )
    .filter(
      (statement) =>
        table === undefined || ('table' in statement && statement.table === table),
    )

const compile = (query: SQL) => new PgDialect().sqlToQuery(query)

const record = (overrides: Partial<DurableImportRecord> = {}): DurableImportRecord => ({
  referenceKey: REFERENCE_KEY,
  keyVersion: 'v1',
  audience: 'accounts_cursor',
  authorization: AUTHORIZATION,
  payload: { cursor: 'opaque-cursor' },
  affectedPropertyId: null,
  remainingRedemptions: 50,
  claimRequestId: null,
  claimedAt: null,
  issuedAt: ISSUED_AT,
  expiresAt: EXPIRES_AT,
  ...overrides,
})

const storedRow = (
  overrides: Partial<typeof googleImportDiscoveryRecords.$inferSelect> = {},
): typeof googleImportDiscoveryRecords.$inferSelect => ({
  referenceKey: REFERENCE_KEY,
  keyVersion: 'v1',
  audience: 'accounts_cursor',
  organizationId: ORGANIZATION_ID,
  userId: USER_ID,
  connectionId: CONNECTION_ID,
  connectionLifecycleVersion: 3,
  connectionAccessVersion: 5,
  credentialGeneration: 7,
  authorizationVector: { policyVersion: 11, permissionVersion: 13 },
  payload: { cursor: 'opaque-cursor' },
  affectedPropertyId: null,
  remainingRedemptions: 50,
  claimRequestId: null,
  claimedAt: null,
  issuedAt: ISSUED_AT,
  expiresAt: EXPIRES_AT,
  createdAt: ISSUED_AT,
  updatedAt: ISSUED_AT,
  ...overrides,
})

const digestsFor = (...scopes: Parameters<typeof keys.invalidationKeys>[0][]) =>
  scopes.flatMap((scope) => keys.invalidationKeys(scope)).map(({ key }) => key)

describe('durable import scope locks', () => {
  it('locks each distinct scope once, in a deterministic order', async () => {
    const { db, statements } = createFakeDatabase()
    const userScope = invalidationScopeFor('user', [ORGANIZATION_ID, USER_ID])
    const organizationScope = invalidationScopeFor('organization', [ORGANIZATION_ID])

    await db.transaction(async (tx) =>
      acquireDurableImportScopeLocks(tx, [
        userScope,
        organizationScope,
        { ...userScope },
      ]),
    )

    const locks = only(statements, 'execute').map(({ query }) => compile(query))
    expect(locks).toHaveLength(2)
    for (const lock of locks) {
      expect(lock.sql).toBe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))')
    }
    // Sorted, so two transactions that overlap on a scope always take the
    // shared locks in the same order.
    expect(locks.map(({ params }) => params[0])).toEqual([
      JSON.stringify(['organization', organizationScope.value]),
      JSON.stringify(['user', userScope.value]),
    ])
  })

  it('carries the NUL-separated scope value without sending a NUL parameter', async () => {
    const { db, statements } = createFakeDatabase()
    const userScope = invalidationScopeFor('user', [ORGANIZATION_ID, USER_ID])

    await db.transaction(async (tx) => acquireDurableImportScopeLocks(tx, [userScope]))

    const [lock] = only(statements, 'execute').map(({ query }) => compile(query))
    const name = lock?.params[0]
    expect(userScope.value).toContain('\0')
    // PostgreSQL rejects a NUL byte in a text parameter, so the separator has
    // to survive the trip as an escape rather than as a raw byte.
    expect(name).not.toContain('\0')
    expect(JSON.parse(String(name))).toEqual(['user', `${ORGANIZATION_ID}\0${USER_ID}`])
  })

  it('separates scopes of different kinds that share a value', async () => {
    const { db, statements } = createFakeDatabase()

    await db.transaction(async (tx) =>
      acquireDurableImportScopeLocks(tx, [
        invalidationScopeFor('user', [ORGANIZATION_ID, USER_ID]),
        invalidationScopeFor('connection', [ORGANIZATION_ID, USER_ID]),
      ]),
    )

    const names = only(statements, 'execute').map(({ query }) => compile(query).params[0])
    expect(new Set(names).size).toBe(2)
  })

  it('issues no statement when there is no scope to lock', async () => {
    const { db, statements } = createFakeDatabase()

    await db.transaction(async (tx) => acquireDurableImportScopeLocks(tx, []))

    expect(statements).toEqual([])
  })
})

describe('durable import checkpoint writes', () => {
  it('locks the scope before it probes the invalidation fence', async () => {
    const { db, statements } = createFakeDatabase({ invalidations: [] })

    await insertDurableImportRecords(db, keys, [record()], [CONNECTION_SCOPE], NOW)

    expect(statements.map(({ op }) => op)).toEqual([
      'execute',
      'delete',
      'select',
      'insert',
    ])
  })

  it('clears only already-expired fences before probing for a live one', async () => {
    const { db, statements } = createFakeDatabase({ invalidations: [] })
    const digests = digestsFor(CONNECTION_SCOPE)
    expect(digests.length).toBeGreaterThan(0)

    await insertDurableImportRecords(db, keys, [record()], [CONNECTION_SCOPE], NOW)

    const [sweep] = only(statements, 'delete', googleImportDiscoveryInvalidations)
    const [probe] = only(statements, 'select', googleImportDiscoveryInvalidations)
    const sweepQuery = compile(sweep!.where)
    const probeQuery = compile(probe!.where)

    expect(sweepQuery.params).toEqual([...digests, NOW.toISOString()])
    expect(sweepQuery.sql).toContain('"expires_at" <=')
    expect(probeQuery.params).toEqual([...digests, NOW.toISOString()])
    expect(probeQuery.sql).toContain('"expires_at" >')
    expect(probe!.limit).toBe(1)
  })

  it('refuses to persist behind a live invalidation fence', async () => {
    const { db, statements } = createFakeDatabase({ invalidations: [{ key: 'live' }] })

    await expect(
      insertDurableImportRecords(db, keys, [record()], [CONNECTION_SCOPE], NOW),
    ).rejects.toBeInstanceOf(DurableImportReferenceInvalidated)
    expect(only(statements, 'insert')).toEqual([])
  })

  it('applies the fence to a terminal page that has nothing to persist', async () => {
    const { db, statements } = createFakeDatabase({ invalidations: [{ key: 'live' }] })

    await expect(
      insertDurableImportRecords(db, keys, [], [CONNECTION_SCOPE], NOW),
    ).rejects.toBeInstanceOf(DurableImportReferenceInvalidated)
    expect(only(statements, 'execute')).toHaveLength(1)
  })

  it('writes no row for a terminal page that passes the fence', async () => {
    const { db, statements } = createFakeDatabase({ invalidations: [] })

    await insertDurableImportRecords(db, keys, [], [CONNECTION_SCOPE], NOW)

    expect(only(statements, 'select', googleImportDiscoveryInvalidations)).toHaveLength(1)
    expect(only(statements, 'insert')).toEqual([])
  })

  it('flattens the authorization into the stored columns', async () => {
    const { db, statements } = createFakeDatabase({ invalidations: [] })

    await insertDurableImportRecords(
      db,
      keys,
      [record({ affectedPropertyId: '83000000-0000-4000-8000-000000000003' })],
      [CONNECTION_SCOPE],
      NOW,
    )

    const [insert] = only(statements, 'insert', googleImportDiscoveryRecords)
    expect(insert!.values).toEqual([
      {
        referenceKey: REFERENCE_KEY,
        keyVersion: 'v1',
        audience: 'accounts_cursor',
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        connectionId: CONNECTION_ID,
        connectionLifecycleVersion: 3,
        connectionAccessVersion: 5,
        credentialGeneration: 7,
        authorizationVector: AUTHORIZATION.authorizationVector,
        payload: { cursor: 'opaque-cursor' },
        affectedPropertyId: '83000000-0000-4000-8000-000000000003',
        remainingRedemptions: 50,
        claimRequestId: null,
        claimedAt: null,
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
        // The issue instant is the row's creation instant — an import that
        // replays must not look newer than the checkpoint it replays.
        createdAt: ISSUED_AT,
        updatedAt: ISSUED_AT,
      },
    ])
  })

  it('treats a partially applied insert as a reference-key collision', async () => {
    const { db } = createFakeDatabase({
      invalidations: [],
      inserted: [{ key: REFERENCE_KEY }],
    })

    await expect(
      insertDurableImportRecords(
        db,
        keys,
        [record(), record({ referenceKey: 'b'.repeat(43) })],
        [CONNECTION_SCOPE],
        NOW,
      ),
    ).rejects.toBeInstanceOf(DurableImportReferenceCollision)
  })

  it('accepts an insert that applied every supplied row', async () => {
    const { db, statements } = createFakeDatabase({ invalidations: [] })

    await expect(
      insertDurableImportRecords(
        db,
        keys,
        [record(), record({ referenceKey: 'b'.repeat(43) })],
        [CONNECTION_SCOPE],
        NOW,
      ),
    ).resolves.toBeUndefined()
    expect(
      only(statements, 'insert', googleImportDiscoveryRecords)[0]!.values,
    ).toHaveLength(2)
  })
})

describe('durable import checkpoint reads', () => {
  it('binds both the reference key and the audience', async () => {
    const { db, statements } = createFakeDatabase({ records: [storedRow()] })

    await loadDurableImportRecord(db, REFERENCE_KEY, 'accounts_cursor', NOW)

    const [read] = only(statements, 'select', googleImportDiscoveryRecords)
    // Without the audience binding a cursor handle would resolve against a
    // candidate checkpoint that happens to share the derived key.
    expect(compile(read!.where).params).toEqual([REFERENCE_KEY, 'accounts_cursor'])
    expect(read!.limit).toBe(1)
  })

  it('rebuilds the authorization from the flat row columns', async () => {
    const { db } = createFakeDatabase({ records: [storedRow()] })

    const loaded = await loadDurableImportRecord(
      db,
      REFERENCE_KEY,
      'accounts_cursor',
      NOW,
    )

    expect(loaded).toEqual({ status: 'found', record: record() })
  })

  it('reports a missing checkpoint without deleting anything', async () => {
    const { db, statements } = createFakeDatabase({ records: [] })

    const loaded = await loadDurableImportRecord(
      db,
      REFERENCE_KEY,
      'accounts_cursor',
      NOW,
    )

    expect(loaded).toEqual({ status: 'missing' })
    expect(only(statements, 'delete')).toEqual([])
  })

  it('expires a checkpoint at its expiry instant and deletes the row', async () => {
    const { db, statements } = createFakeDatabase({
      records: [storedRow({ expiresAt: NOW })],
    })

    const loaded = await loadDurableImportRecord(
      db,
      REFERENCE_KEY,
      'accounts_cursor',
      NOW,
    )

    expect(loaded).toEqual({ status: 'expired' })
    const [removal] = only(statements, 'delete', googleImportDiscoveryRecords)
    expect(compile(removal!.where).params).toEqual([REFERENCE_KEY])
  })

  it('still serves a checkpoint one millisecond before it expires', async () => {
    const { db, statements } = createFakeDatabase({
      records: [storedRow({ expiresAt: new Date(NOW.getTime() + 1) })],
    })

    const loaded = await loadDurableImportRecord(
      db,
      REFERENCE_KEY,
      'accounts_cursor',
      NOW,
    )

    expect(loaded.status).toBe('found')
    expect(only(statements, 'delete')).toEqual([])
  })
})

describe('durable import checkpoint existence probe', () => {
  it('answers false for an empty key list without querying', async () => {
    const { db, statements } = createFakeDatabase()

    await expect(durableImportReferenceExists(db, [])).resolves.toBe(false)
    expect(statements).toEqual([])
  })

  it('probes every supplied key across audiences', async () => {
    const alternates = [REFERENCE_KEY, 'b'.repeat(43)]
    const { db, statements } = createFakeDatabase({ records: [{ key: REFERENCE_KEY }] })

    await expect(durableImportReferenceExists(db, alternates)).resolves.toBe(true)

    const [probe] = only(statements, 'select', googleImportDiscoveryRecords)
    const query = compile(probe!.where)
    expect(query.params).toEqual(alternates)
    // Deliberately audience-free: this probe is what distinguishes a handle
    // bound to another audience from a handle that was never issued.
    expect(query.sql).not.toContain('audience')
  })

  it('answers false when no supplied key resolves', async () => {
    const { db } = createFakeDatabase({ records: [] })

    await expect(durableImportReferenceExists(db, [REFERENCE_KEY])).resolves.toBe(false)
  })
})
