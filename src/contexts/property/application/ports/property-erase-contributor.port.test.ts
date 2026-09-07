// LIF-01-T19 contract test — the Property Erase contributor registry.
//
// PROPERTY_ERASE_CONTEXTS is the closed set of stable data-owner slots the
// erase path answers for: the preview the AccountAdmin confirms is assembled
// per slot, and receipts are keyed by that slot so an interrupted purge can
// resume. A bounded context missing all of its slots is one nobody waits on,
// which is exactly the "partial erasure looks complete" failure the port names.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import { createGuestPropertyEraseContributor } from '#/contexts/guest/infrastructure/adapters/guest-property-erase.adapter'
import { createPropertyPropertyEraseContributor } from '../../infrastructure/adapters/property-property-erase.adapter'
import { PROPERTY_ERASE_CONTEXTS } from './property-erase-contributor.port'

const registered: readonly string[] = PROPERTY_ERASE_CONTEXTS

const boundedContextDirectories = (): readonly string[] =>
  readdirSync(join(process.cwd(), 'src', 'contexts'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

/**
 * Context merges do not rewrite durable receipt keys or collapse independently
 * reviewed purge plans. Map a merged boundary to the stable data-owner slots it
 * now contains; an unmerged context keeps its directory name as its sole slot.
 */
const MERGED_CONTEXT_ERASE_OWNERS: Readonly<Record<string, readonly string[]>> = {
  feed: ['activity', 'notification'],
  identity: ['identity', 'staff'],
  reporting: ['dashboard', 'goal', 'metric'],
}

const eraseOwnersForDirectory = (directory: string): readonly string[] =>
  MERGED_CONTEXT_ERASE_OWNERS[directory] ?? [directory]

const boundedContextEraseOwners = (): readonly string[] =>
  [
    ...new Set(
      boundedContextDirectories().flatMap((directory) =>
        eraseOwnersForDirectory(directory),
      ),
    ),
  ].sort()

describe('PROPERTY_ERASE_CONTEXTS', () => {
  it('registers every bounded context data-owner slot', () => {
    const absent = boundedContextDirectories().filter((directory) =>
      eraseOwnersForDirectory(directory).some((owner) => !registered.includes(owner)),
    )

    // An empty set is what makes a NEWLY ADDED context fail here rather than
    // silently sit out an erase. Do not add an empty mapping to make a missing
    // contributor pass: every boundary must retain at least one reviewed slot.
    expect(absent).toEqual([])
  })

  it('does not register a data-owner slot without a bounded-context owner', () => {
    const boundedOwners = boundedContextEraseOwners()

    expect(registered.filter((context) => !boundedOwners.includes(context))).toEqual([])
  })

  it('names only contexts the Organization lifecycle also enumerates', () => {
    const canonical: readonly string[] = ORGANIZATION_LIFECYCLE_CONTEXTS

    expect(registered.filter((context) => !canonical.includes(context))).toEqual([])
  })

  it('keeps lifecycle receipt keys distinct and canonically ordered', () => {
    // The preview digest sorts `context:table:rowCount` lines and receipts are
    // keyed on (authority, context, phase); a duplicate would double-count a
    // context in the total the AccountAdmin agrees to destroy.
    expect(registered).toEqual([...new Set(registered)])
    expect(registered).toEqual([...registered].sort())
    expect(registered).toHaveLength(14)
  })

  it('uses stable context keys in lifecycle events', () => {
    for (const context of registered) {
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
