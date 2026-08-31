// LIF-01-T11 — the completeness proof for the Organization Export set.
//
// These assertions exist because a partial set is the failure mode that would
// not announce itself: an archive missing one context still opens, still has a
// manifest, and still looks complete to whoever receives it.

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import type { Database } from '#/shared/db'
import {
  NON_IDENTITY_EXPORT_CONTRIBUTOR_COUNT,
  buildOrganizationExportContributors,
  buildOrganizationLifecycleContributors,
} from './organization-export-contributors'

const db = {} as Database

describe('organization export contributor set', () => {
  it('covers every lifecycle context except identity, exactly once', () => {
    const contexts = buildOrganizationExportContributors(db).map(
      (contributor) => contributor.context,
    )
    const expected = ORGANIZATION_LIFECYCLE_CONTEXTS.filter(
      (context) => context !== 'identity',
    )

    expect([...contexts].sort()).toEqual([...expected].sort())
    expect(new Set(contexts).size).toBe(contexts.length)
  })

  it('omits identity, which supplies its own reviewed contributor', () => {
    const contexts = buildOrganizationExportContributors(db).map(
      (contributor) => contributor.context,
    )
    expect(contexts).not.toContain('identity')
  })

  it('states its own size, so a dropped contributor fails here and not in an archive', () => {
    expect(buildOrganizationExportContributors(db)).toHaveLength(
      NON_IDENTITY_EXPORT_CONTRIBUTOR_COUNT,
    )
    expect(NON_IDENTITY_EXPORT_CONTRIBUTOR_COUNT).toBe(
      ORGANIZATION_LIFECYCLE_CONTEXTS.length - 1,
    )
  })

  it('constructs without touching the database, so build order cannot matter', () => {
    // A contributor that queried at construction time would throw on the empty
    // stub above. Identity is built long before most of these contexts exist.
    expect(() => buildOrganizationExportContributors(db)).not.toThrow()
  })

  it('returns a frozen set', () => {
    expect(Object.isFrozen(buildOrganizationExportContributors(db))).toBe(true)
  })
})

describe('organization lifecycle contributor set', () => {
  const integration = { context: 'integration' as const } as never

  it('covers every lifecycle context except identity, exactly once', () => {
    const contexts = buildOrganizationLifecycleContributors(db, integration).map(
      (contributor) => contributor.context,
    )
    const expected = ORGANIZATION_LIFECYCLE_CONTEXTS.filter(
      (context) => context !== 'identity',
    )

    expect([...contexts].sort()).toEqual([...expected].sort())
    expect(new Set(contexts).size).toBe(contexts.length)
  })

  it('refuses a misidentified Integration contributor', () => {
    expect(() =>
      buildOrganizationLifecycleContributors(db, { context: 'portal' } as never),
    ).toThrow(/misidentified/iu)
  })

  it('is NOT composed into the default container', async () => {
    // Destructive activation waits for crash recovery, backup-erasure fencing
    // and counsel-approved retention. Readiness reporting seventeen missing
    // contexts is the honest state, not a gap — composing the set by default
    // would arm the purge coordinator.
    const source = await readFile(new URL('../composition.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('buildOrganizationLifecycleContributors')
    expect(source).not.toContain('lifecycleContributors:')
  })
})
