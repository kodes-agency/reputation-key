// Notification context — the escalation-resolution lookup.
//
// The port is documented content-free and Organization-fenced, and neither
// claim is checkable from a return value alone. So the reads themselves are
// what is asserted: the fake `Database` captures each projection and each
// WHERE, and the predicates are rendered through the real PostgreSQL dialect
// and compared whole — an `and` weakened to an `or` renders every term the
// fence needs and still matches on the id alone, so a per-term substring check
// would not see it. That catches the two mistakes that would not announce
// themselves —
//
//   - dropping either organization_id term, or ORing rather than ANDing them,
//     which turns a known inbox item id into a cross-tenant read of another
//     Organization's assignee and property name (the adapter is reached from a
//     queued delivery, so the id is not necessarily one the caller ever owned);
//   - widening the projection onto a guest-content column, which would put
//     review/feedback text into a notification the port promises never carries
//     it.
//
// The second read is skipped entirely when the item is missing, which is only
// visible by counting the reads.

import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { inboxItemId, organizationId } from '#/shared/domain/ids'
import { createEscalationResolutionLookupAdapter } from './escalation-resolution-lookup.adapter'

const ORG = organizationId('b8100000-0000-4000-8000-000000000001')
const OTHER_ORG = organizationId('b8100000-0000-4000-8000-000000000002')
const ITEM = inboxItemId('b8100000-0000-4000-8000-000000000040')
const PROPERTY = 'b8100000-0000-4000-8000-000000000010'
const ASSIGNEE = 'b8100000-0000-4000-8000-000000000050'
const RESOLVER = 'b8100000-0000-4000-8000-000000000051'
const RESOLVED_AT = new Date('2026-06-01T10:00:00.000Z')

type Read = {
  /** Alias → physical column name, as the adapter asked for it. */
  projection: Record<string, string | undefined>
  where: SQL | null
  limit: number | null
}

const ITEM_ROW = {
  propertyId: PROPERTY,
  assignedTo: ASSIGNEE,
  isEscalated: false,
  resolvedAt: RESOLVED_AT,
  resolvedBy: RESOLVER,
}

/**
 * Serves `rows[n]` to the n-th `select(...)` chain and records what that chain
 * asked for. An unexpected extra read gets an empty result and is visible as an
 * extra entry in `reads`.
 */
const fakeDb = (reads: Read[], rows: ReadonlyArray<readonly unknown[]>): Database => {
  let call = -1
  return {
    select: (projection: Record<string, { name?: string }>) => {
      call += 1
      const index = call
      reads.push({
        projection: Object.fromEntries(
          Object.entries(projection).map(([alias, column]) => [alias, column?.name]),
        ),
        where: null,
        limit: null,
      })
      return {
        from: () => ({
          where: (where: SQL) => {
            reads[index]!.where = where
            return {
              limit: async (limit: number) => {
                reads[index]!.limit = limit
                return rows[index] ?? []
              },
            }
          },
        }),
      }
    },
  } as unknown as Database
}

const rendered = (read: Read | undefined): { sql: string; params: unknown[] } => {
  if (!read?.where) throw new Error('no SQL was captured from the fake database')
  const query = new PgDialect().sqlToQuery(read.where)
  return { sql: query.sql, params: [...query.params] }
}

const lookup = (reads: Read[], rows: ReadonlyArray<readonly unknown[]>) =>
  createEscalationResolutionLookupAdapter(fakeDb(reads, rows))

describe('escalation resolution lookup — Organization fencing', () => {
  it('fences the inbox-item read on the caller Organization as well as the item id', async () => {
    const reads: Read[] = []

    await lookup(reads, [
      [ITEM_ROW],
      [{ name: 'Seaside Hotel' }],
    ]).findEscalationResolutionFacts(ITEM, ORG)

    const { sql, params } = rendered(reads[0])
    // Whole-predicate, not two `toContain`s: the conjunction is the fence. A
    // predicate holding both terms under `or` renders the same substrings and
    // binds the same params, but matches on the item id alone.
    expect(sql).toBe('("inbox_items"."id" = $1 and "inbox_items"."organization_id" = $2)')
    expect(params).toEqual([ITEM, ORG])
    expect(reads[0]?.limit).toBe(1)
  })

  it('fences the property read on the caller Organization, not on the row alone', async () => {
    const reads: Read[] = []

    await lookup(reads, [
      [ITEM_ROW],
      [{ name: 'Seaside Hotel' }],
    ]).findEscalationResolutionFacts(ITEM, ORG)

    const { sql, params } = rendered(reads[1])
    expect(sql).toBe('("properties"."organization_id" = $1 and "properties"."id" = $2)')
    expect(params).toEqual([ORG, PROPERTY])
    expect(reads[1]?.limit).toBe(1)
  })

  it('binds the Organization the caller passed, not one carried by the row', async () => {
    const reads: Read[] = []

    await lookup(reads, [
      [ITEM_ROW],
      [{ name: 'Seaside Hotel' }],
    ]).findEscalationResolutionFacts(ITEM, OTHER_ORG)

    expect(rendered(reads[0]).params).toEqual([ITEM, OTHER_ORG])
    expect(rendered(reads[1]).params).toEqual([OTHER_ORG, PROPERTY])
  })
})

describe('escalation resolution lookup — content-free projection', () => {
  it('reads only the five fence columns from inbox_items', async () => {
    const reads: Read[] = []

    await lookup(reads, [
      [ITEM_ROW],
      [{ name: 'Seaside Hotel' }],
    ]).findEscalationResolutionFacts(ITEM, ORG)

    expect(reads[0]?.projection).toEqual({
      propertyId: 'property_id',
      assignedTo: 'assigned_to',
      isEscalated: 'is_escalated',
      resolvedAt: 'escalation_resolved_at',
      resolvedBy: 'escalation_resolved_by',
    })
    expect(reads[1]?.projection).toEqual({ name: 'name' })
  })

  it('returns exactly the port fields — no guest content reaches the caller', async () => {
    const reads: Read[] = []

    const facts = await lookup(reads, [
      [ITEM_ROW],
      [{ name: 'Seaside Hotel' }],
    ]).findEscalationResolutionFacts(ITEM, ORG)

    expect(Object.keys(facts ?? {}).sort()).toEqual([
      'assignedTo',
      'isEscalated',
      'propertyId',
      'propertyName',
      'resolvedAt',
      'resolvedBy',
    ])
  })
})

describe('escalation resolution lookup — facts returned', () => {
  it('carries the resolution fence through unchanged', async () => {
    const reads: Read[] = []

    const facts = await lookup(reads, [
      [{ ...ITEM_ROW, isEscalated: true }],
      [{ name: 'Seaside Hotel' }],
    ]).findEscalationResolutionFacts(ITEM, ORG)

    expect(facts).toEqual({
      propertyId: PROPERTY,
      assignedTo: ASSIGNEE,
      propertyName: 'Seaside Hotel',
      isEscalated: true,
      resolvedAt: RESOLVED_AT,
      resolvedBy: RESOLVER,
    })
  })

  it('preserves an unassigned item and an unattributed resolution as null', async () => {
    const reads: Read[] = []

    const facts = await lookup(reads, [
      [{ ...ITEM_ROW, assignedTo: null, resolvedBy: null, resolvedAt: null }],
      [{ name: 'Seaside Hotel' }],
    ]).findEscalationResolutionFacts(ITEM, ORG)

    expect(facts).toEqual(
      expect.objectContaining({ assignedTo: null, resolvedBy: null, resolvedAt: null }),
    )
  })

  it('still returns the fence when the property row is gone', async () => {
    // A deleted property must not suppress the resolution facts — only the
    // display name is unavailable.
    const reads: Read[] = []

    const facts = await lookup(reads, [[ITEM_ROW], []]).findEscalationResolutionFacts(
      ITEM,
      ORG,
    )

    expect(facts).toEqual(
      expect.objectContaining({ propertyName: null, propertyId: PROPERTY }),
    )
  })
})

describe('escalation resolution lookup — missing item', () => {
  it('returns null and never reads properties', async () => {
    const reads: Read[] = []

    const facts = await lookup(reads, [[]]).findEscalationResolutionFacts(ITEM, ORG)

    expect(facts).toBeNull()
    expect(reads).toHaveLength(1)
  })
})
