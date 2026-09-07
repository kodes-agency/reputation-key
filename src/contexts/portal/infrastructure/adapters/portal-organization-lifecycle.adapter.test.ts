import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CAPABILITY_FATE } from '#/shared/governance/capability-fate'
import { PORTAL_PURGE_PLAN } from './portal-organization-lifecycle.adapter'

/** Physical-drop-blocked compatibility mirrors Portal may only DELETE from. */
const COMPATIBILITY_MIRRORS = ['portal_group_members'] as const

describe('Portal Organization lifecycle contributor', () => {
  it('names a bounded purge plan of row deletes, never drops', () => {
    expect(PORTAL_PURGE_PLAN).toContain('portals')
    expect(PORTAL_PURGE_PLAN).toContain('portal_groups')
    for (const table of PORTAL_PURGE_PLAN) {
      expect(table).not.toMatch(/drop|truncate/i)
    }
    // Compatibility mirrors are row-delete targets, never DROP targets.
    for (const mirror of COMPATIBILITY_MIRRORS) {
      expect(PORTAL_PURGE_PLAN).toContain(mirror)
    }
    // Other owners' rows are never in a Portal plan.
    for (const foreign of [
      'properties',
      'guest_responses',
      'portal_metric_lifetime_aggregates',
      'portal_responsibilities',
      'portal_group_memberships',
    ]) {
      expect(PORTAL_PURGE_PLAN).not.toContain(foreign)
    }
  })

  it('keeps the dark Portal upload capability dark', () => {
    // Portal upload has no public issuance surface. A lifecycle contributor
    // must not be the thing that makes a dark capability reachable, so the
    // governance authority is asserted byte-identical: this work changed no
    // capability fate at all.
    expect(CAPABILITY_FATE['portal.upload'].fate).toBe('safety_blocked')
  })

  it('keeps the lifecycle contributor out of the Portal public API', () => {
    const build = readFileSync(
      join(process.cwd(), 'src/contexts/portal/build.ts'),
      'utf8',
    )
    const publicApiBlock = build.slice(
      build.indexOf('const publicApi:'),
      build.indexOf('const portalGroupPublicApi'),
    )
    expect(publicApiBlock).not.toContain('organizationLifecycleContributor')
    expect(publicApiBlock).not.toContain('LifecycleContributor')
    expect(build).toContain('organizationLifecycleContributor')
  })
})
