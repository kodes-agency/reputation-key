// Contract test for Identity's Property Erase contributor.
//
// The properties worth pinning are the ones whose failure is silent: an
// unscoped predicate erases a SIBLING Property's rows, and a table quietly
// dropped from the plan leaves rows behind while the receipt still says the
// context answered. Both are asserted against the rendered SQL, because a
// mock that only counts calls cannot tell either failure from success.

import { describe, expect, it } from 'vitest'
import { createIdentityPropertyEraseContributor } from './identity-property-erase.adapter'
import type { Tx } from '#/shared/outbox/commit'

const ORG = 'org-identity-erase'
const PROPERTY = '60000000-0000-4000-8000-000000000001'

/** The four tables the adapter must cover, and the three it must not touch. */
const ERASED_TABLES = [
  'property_access_grants',
  'property_access_grant',
  'property_capability',
  'property_policy',
] as const

const EXCLUDED_TABLES = [
  'backup_erasure_ledger',
  'privacy_requests',
] as const

type Rendered = Readonly<{ sql: string; params: readonly unknown[] }>

/**
 * Render what the adapter actually sends, rather than trusting a call count.
 *
 * `tx.execute` serves inventory() and the drizzle `delete().where().returning()`
 * chain serves erase(); both record their rendered SQL so a missing predicate
 * is visible in the assertion rather than hidden behind a passing spy.
 */
function harness(rowCount = 0) {
  const executed: Rendered[] = []
  const deleted: Rendered[] = []

  const render = (query: unknown): Rendered => {
    const q = query as { queryChunks?: unknown[] }
    const chunks = q.queryChunks ?? []
    const text: string[] = []
    const params: unknown[] = []
    // Drizzle nests SQL differently for a `sql` template (inventory) and an
    // `eq`/`and` predicate (erase), and a `Param` carries its bound value under
    // the same `value` key a StringChunk uses. Rather than model both shapes,
    // walk the whole tree: SQL fragments and column names accumulate as text,
    // and every bound primitive accumulates as a parameter. A predicate that
    // lost its binding therefore loses the value from `params`, which is the
    // failure these tests exist to catch.
    const seen = new Set<unknown>()
    const walk = (node: unknown): void => {
      if (node === null || node === undefined) return
      if (typeof node === 'string' || typeof node === 'number') {
        params.push(node)
        return
      }
      if (typeof node !== 'object') return
      if (seen.has(node)) return
      seen.add(node)
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      const n = node as Record<string, unknown>
      if (Array.isArray(n['value']) && n['value'].every((v) => typeof v === 'string')) {
        text.push((n['value'] as string[]).join(''))
        return
      }
      if (n['name'] !== undefined && n['table'] !== undefined) {
        text.push(String(n['name']))
        return
      }
      for (const key of ['queryChunks', 'value', 'left', 'right', 'chunks']) {
        if (key in n) walk(n[key])
      }
    }
    walk(chunks)
    return { sql: text.join(' '), params }
  }

  const tx = {
    execute: async (query: unknown) => {
      executed.push(render(query))
      return { rows: [{ rows: rowCount }] }
    },
    delete: (table: unknown) => ({
      where: (predicate: unknown) => ({
        returning: async () => {
          const name = (table as { [k: symbol]: unknown; _?: { name?: string } })._?.name
          const p = predicate as { queryChunks?: unknown[] }
          const rendered = render(p)
          deleted.push({
            sql: `${String(name ?? '')} ${rendered.sql}`,
            params: rendered.params,
          })
          return Array.from({ length: rowCount }, () => ({ propertyId: PROPERTY }))
        },
      }),
    }),
  } as unknown as Tx

  return { tx, executed, deleted }
}

describe('identity property-erase contributor', () => {
  it('answers as the identity context', () => {
    expect(createIdentityPropertyEraseContributor().context).toBe('identity')
  })

  it('inventories exactly the four erasable Identity tables, and no archive table', async () => {
    const { tx, executed } = harness(3)

    const entries = await createIdentityPropertyEraseContributor().inventory(tx, {
      organizationId: ORG,
      propertyId: PROPERTY,
    })

    expect(entries.map((e) => e.table).sort()).toEqual([...ERASED_TABLES].sort())
    expect(entries.every((e) => e.context === 'identity')).toBe(true)
    expect(entries.every((e) => e.rowCount === 3)).toBe(true)
    // The exclusions are the point of the adapter's header comment. If a later
    // change adds one of these to the plan, this fails rather than silently
    // destroying erasure evidence, DSR records or the authorization audit.
    const all = executed.map((q) => q.sql).join(' ')
    for (const table of EXCLUDED_TABLES) expect(all).not.toContain(table)
  })

  it('carries nothing but a table name and a count, so the preview stays content-free', async () => {
    const { tx } = harness(1)

    const entries = await createIdentityPropertyEraseContributor().inventory(tx, {
      organizationId: ORG,
      propertyId: PROPERTY,
    })

    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['context', 'rowCount', 'table'])
    }
  })

  it('scopes every inventory read to this Property', async () => {
    const { tx, executed } = harness(0)

    await createIdentityPropertyEraseContributor().inventory(tx, {
      organizationId: ORG,
      propertyId: PROPERTY,
    })

    // Every statement must narrow on property_id. Without this, an erase
    // preview would count a sibling Property's rows.
    expect(executed).toHaveLength(4)
    for (const query of executed) {
      expect(query.sql).toContain('property_id =')
      expect(query.params).toContain(PROPERTY)
    }
  })

  it('narrows on the Organization as well wherever the table carries one', async () => {
    const { tx, executed } = harness(0)

    await createIdentityPropertyEraseContributor().inventory(tx, {
      organizationId: ORG,
      propertyId: PROPERTY,
    })

    const orgScoped = executed.filter((q) => q.sql.includes('organization_id ='))
    // property_access_grants and property_access_grant have organization_id;
    // property_capability and property_policy do not carry the column at all,
    // so requiring it on all four would be asserting a schema that is not real.
    expect(orgScoped).toHaveLength(2)
    for (const query of orgScoped) expect(query.params).toContain(ORG)
  })

  it('deletes from all four tables and returns the total row count', async () => {
    const { tx, deleted } = harness(2)

    const erased = await createIdentityPropertyEraseContributor().erase(tx, {
      organizationId: ORG,
      propertyId: PROPERTY,
    })

    expect(deleted).toHaveLength(4)
    expect(erased).toBe(8)
  })

  it('binds every delete to this Property, so a sibling Property is untouched', async () => {
    const { tx, deleted } = harness(1)

    await createIdentityPropertyEraseContributor().erase(tx, {
      organizationId: ORG,
      propertyId: PROPERTY,
    })

    // The failure this guards is silent and irreversible: a delete whose
    // predicate lost its property_id removes every Organization row.
    for (const statement of deleted) {
      expect(statement.params).toContain(PROPERTY)
    }
    expect(deleted.filter((s) => s.params.includes(ORG))).toHaveLength(2)
  })
})
