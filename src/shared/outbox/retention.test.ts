import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import { EVENT_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'

const DAY = 24 * 60 * 60 * 1_000
const NOW = new Date('2026-11-06T12:00:00.000Z')
const CUTOFF = new Date(NOW.getTime() - 30 * DAY)
const OLD = new Date(CUTOFF.getTime() - DAY).toISOString()
const LIVE = new Date(CUTOFF.getTime() + DAY).toISOString()
const CONSUMERS = [
  'activity.operational-action-history',
  'portal.reconcile-health-dependencies',
]

const rule = RETENTION_RULES.find(({ subject }) => subject === 'outbox_events.published')
if (!rule) throw new Error('Outbox retention rule missing')

let sqlite: DatabaseSync
let db: Database

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE outbox_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      published_at TEXT,
      recovery_fenced_at TEXT,
      consumer_redelivery_attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE event_consumer_receipts (
      event_id TEXT NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE,
      consumer_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('applied', 'duplicate', 'obsolete')),
      PRIMARY KEY (event_id, consumer_name)
    );
  `)
  // Execute the production batch query against an isolated relational engine;
  // no PostgreSQL or Redis service is used by these unit cases.
  db = {
    execute: async (statement: SQL) => {
      const query = new PgDialect().sqlToQuery(statement)
      const parameters: Record<string, SQLInputValue> = {}
      query.params.forEach((value: unknown, index) => {
        if (value instanceof Date) parameters[String(index + 1)] = value.toISOString()
        else if (typeof value === 'string' || typeof value === 'number' || value === null)
          parameters[String(index + 1)] = value
        else throw new Error('Unsupported retention query parameter')
      })
      const rows = sqlite.prepare(query.sql).all(parameters)
      return { rows, rowCount: rows.length }
    },
  } as unknown as Database
})

afterEach(() => sqlite.close())

function fact(
  id: string,
  options: {
    eventType?: string
    publishedAt?: string | null
    fenced?: boolean
    exhausted?: boolean
  } = {},
) {
  sqlite
    .prepare(
      `
      INSERT INTO outbox_events
        (id, event_type, published_at, recovery_fenced_at, consumer_redelivery_attempts)
      VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(
      id,
      options.eventType ?? 'property.deleted',
      options.publishedAt === undefined ? OLD : options.publishedAt,
      options.fenced ? OLD : null,
      options.exhausted ? 3 : 0,
    )
}

function receipt(id: string, consumer: string, status = 'applied') {
  sqlite
    .prepare(
      `
      INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
      VALUES (?, ?, ?)
    `,
    )
    .run(id, consumer, status)
}

function storedFacts() {
  return sqlite.prepare('SELECT id FROM outbox_events ORDER BY id').all()
}

async function sweep(batchSize = 500, maxBatches = 100) {
  return executeRetentionRule(db, rule!, { cutoff: CUTOFF, batchSize, maxBatches })
}

describe('outbox retention settlement', () => {
  it('requires every catalogue consumer receipt for each consumed event family', async () => {
    const unresolved: string[] = []
    let settledCount = 0
    for (const { eventType, consumers } of EVENT_FAMILY_ROWS) {
      const settledId = `${eventType}:settled`
      fact(settledId, { eventType })
      for (const { name } of consumers) receipt(settledId, name)
      settledCount++
      for (const missing of consumers) {
        const owedId = `${eventType}:missing:${missing.name}`
        fact(owedId, { eventType })
        for (const { name } of consumers) {
          if (name !== missing.name) receipt(owedId, name)
        }
        unresolved.push(owedId)
      }
    }

    expect((await sweep()).rowsDeleted).toBe(settledCount)
    expect(storedFacts()).toEqual(unresolved.sort().map((id) => ({ id })))
  })

  it('keeps an expired fact missing any required receipt, even after redelivery exhausted', async () => {
    fact('missing-all', { exhausted: true })
    fact('missing-one', { exhausted: true })
    receipt('missing-one', CONSUMERS[0]!)

    expect((await sweep()).rowsDeleted).toBe(0)
    expect(storedFacts()).toEqual([{ id: 'missing-all' }, { id: 'missing-one' }])
    expect(
      sqlite.prepare('SELECT count(*) AS count FROM event_consumer_receipts').get(),
    ).toEqual({ count: 1 })
  })

  it.each(['applied', 'duplicate', 'obsolete'])(
    'removes a settled expired fact and cascades its %s receipts',
    async (status) => {
      fact('settled')
      for (const consumer of CONSUMERS) receipt('settled', consumer, status)

      expect((await sweep()).rowsDeleted).toBe(1)
      expect(storedFacts()).toEqual([])
      expect(
        sqlite.prepare('SELECT count(*) AS count FROM event_consumer_receipts').get(),
      ).toEqual({ count: 0 })
    },
  )

  it('does not borrow another event receipt or an unrelated consumer receipt', async () => {
    fact('owed')
    receipt('owed', CONSUMERS[0]!)
    receipt('owed', 'unrelated.consumer')
    fact('settled')
    for (const consumer of CONSUMERS) receipt('settled', consumer)

    expect((await sweep()).rowsDeleted).toBe(1)
    expect(storedFacts()).toEqual([{ id: 'owed' }])
  })

  it('removes expired audit-only facts without inventing a receipt requirement', async () => {
    fact('audit', { eventType: 'inbox.inbox_item.priority_changed' })

    expect((await sweep()).rowsDeleted).toBe(1)
    expect(storedFacts()).toEqual([])
  })

  it('keeps unpublished, young, boundary and recovery-fenced facts', async () => {
    fact('unpublished', { publishedAt: null })
    fact('young', { publishedAt: LIVE })
    fact('boundary', { publishedAt: CUTOFF.toISOString() })
    fact('fenced', { fenced: true })
    for (const id of ['unpublished', 'young', 'boundary', 'fenced']) {
      for (const consumer of CONSUMERS) receipt(id, consumer)
    }

    expect((await sweep()).rowsDeleted).toBe(0)
    expect(storedFacts()).toEqual([
      { id: 'boundary' },
      { id: 'fenced' },
      { id: 'unpublished' },
      { id: 'young' },
    ])
  })

  it('skips an older unresolved fact while capped batches retire settled facts', async () => {
    fact('unresolved', {
      publishedAt: new Date(CUTOFF.getTime() - 2 * DAY).toISOString(),
    })
    fact('settled-a')
    fact('settled-b')
    for (const id of ['settled-a', 'settled-b']) {
      for (const consumer of CONSUMERS) receipt(id, consumer)
    }

    expect(await sweep(1, 1)).toMatchObject({ rowsDeleted: 1, capped: true })
    expect(await sweep(1, 1)).toMatchObject({ rowsDeleted: 1, capped: true })
    expect(await sweep(1, 1)).toMatchObject({ rowsDeleted: 0, capped: false })
    expect(storedFacts()).toEqual([{ id: 'unresolved' }])
  })
})
