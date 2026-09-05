// LIF-01-T19 contract test — the Property Erase contributor registry.
//
// PROPERTY_ERASE_CONTEXTS is the closed set the erase path answers for: the
// preview the AccountAdmin confirms is assembled per context, and receipts are
// keyed by context so an interrupted purge can resume. A bounded context that
// is missing from this list is a context nobody waits on, which is exactly the
// "partial erasure looks complete" failure the port header names.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import { createGuestPropertyEraseContributor } from '#/contexts/guest/infrastructure/adapters/guest-property-erase.adapter'
import { propertyEraseContextReceipts } from '#/shared/db/schema/property-erase.schema'
import { createPropertyPropertyEraseContributor } from '../../infrastructure/adapters/property-property-erase.adapter'
import { PROPERTY_ERASE_CONTEXTS } from './property-erase-contributor.port'

const registered: readonly string[] = PROPERTY_ERASE_CONTEXTS

const boundedContextDirectories = (): readonly string[] =>
  readdirSync(join(process.cwd(), 'src', 'contexts'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

/** The declared width of `property_erase_context_receipts.context`. */
const receiptContextColumnLength = (): number => {
  const column = getTableConfig(propertyEraseContextReceipts).columns.find(
    (candidate) => candidate.name === 'context',
  )
  const length = (column as unknown as { length?: number } | undefined)?.length
  if (length === undefined) {
    throw new Error('property_erase_context_receipts.context has no declared width')
  }
  return length
}

describe('PROPERTY_ERASE_CONTEXTS', () => {
  it('registers every bounded context', () => {
    const absent = boundedContextDirectories().filter(
      (directory) => !registered.includes(directory),
    )

    // An empty set is what makes a NEWLY ADDED context fail here rather than
    // silently sit out an erase. `identity` used to be the one exception, and
    // it was a defect, not a decision: `data-fate-authority.ts` names Identity
    // the owner of seven Property-scoped tables, so the omission asserted
    // something false. Its contributor is
    // identity-property-erase.adapter.ts. Do not re-add an exception here to
    // make a missing contributor pass — write the contributor.
    expect(absent).toEqual([])
  })

  it('does not register a context that has no bounded-context directory', () => {
    const directories = boundedContextDirectories()

    expect(registered.filter((context) => !directories.includes(context))).toEqual([])
  })

  it('names only contexts the Organization lifecycle also enumerates', () => {
    const canonical: readonly string[] = ORGANIZATION_LIFECYCLE_CONTEXTS

    expect(registered.filter((context) => !canonical.includes(context))).toEqual([])
  })

  it('is distinct and canonically ordered', () => {
    // The preview digest sorts `context:table:rowCount` lines and receipts are
    // keyed on (authority, context, phase); a duplicate would double-count a
    // context in the total the AccountAdmin agrees to destroy.
    expect(registered).toEqual([...new Set(registered)])
    expect(registered).toEqual([...registered].sort())
    expect(registered).toHaveLength(14)
  })

  it('fits every context into the receipt column, so each receipt is writable', () => {
    const width = receiptContextColumnLength()

    for (const context of registered) {
      expect(context.length).toBeLessThanOrEqual(width)
      expect(context).toMatch(/^[a-z][a-z_]*$/u)
    }
  })
})

describe('PropertyEraseContributor implementations', () => {
  it('declare a registered context, so their receipts are ones the purge waits for', () => {
    const contributors = [
      createGuestPropertyEraseContributor(),
      createPropertyPropertyEraseContributor(),
    ]

    expect(contributors.map((contributor) => contributor.context)).toEqual([
      'guest',
      'property',
    ])
    for (const contributor of contributors) {
      expect(registered).toContain(contributor.context)
    }
  })

  it('answer content-free inventory entries — the Property adapter returns a table name and a count, nothing else', async () => {
    // Scoped to the Property adapter on purpose: its inventory is a single
    // counting query, so the fake transaction below can return the shape the
    // adapter reads and the entries can be inspected without a database. The
    // Guest adapter's inventory is NOT exercised here or anywhere else — the
    // erase integration test bypasses preview by calling store.recordPreview
    // with a precomputed digest, so contributor.inventory never runs there.
    const tx = {
      execute: async () => ({ rows: [{ properties: 1, managers: 3 }] }),
    } as unknown as Parameters<
      ReturnType<typeof createPropertyPropertyEraseContributor>['inventory']
    >[0]

    const entries = await createPropertyPropertyEraseContributor().inventory(tx, {
      organizationId: 'org-1',
      propertyId: 'a0000000-0000-0000-0000-000000000001',
    })

    expect(entries).toEqual([
      { context: 'property', table: 'properties', rowCount: 1 },
      { context: 'property', table: 'property_responsible_managers', rowCount: 3 },
    ])
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['context', 'rowCount', 'table'])
      expect(registered).toContain(entry.context)
    }
  })
})
