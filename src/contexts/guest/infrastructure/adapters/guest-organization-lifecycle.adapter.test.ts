import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CAPABILITY_FATE } from '#/shared/governance/capability-fate'

describe('Guest Organization lifecycle contributor', () => {
  it('keeps the dark Contact Request capability dark', () => {
    expect(CAPABILITY_FATE['portal.guest_contact'].fate).toBe('safety_blocked')
    expect(CAPABILITY_FATE['portal.guest_media'].fate).toBe('beta_disabled')
  })

  it('keeps the lifecycle contributor out of the Guest public API', () => {
    const build = readFileSync(join(process.cwd(), 'src/contexts/guest/build.ts'), 'utf8')
    const publicApiBlock = build.slice(
      build.indexOf('const publicApi = {'),
      build.indexOf('// ARC-03-T11'),
    )
    expect(publicApiBlock).not.toContain('organizationLifecycleContributor')
    expect(publicApiBlock).not.toContain('LifecycleContributor')
    expect(build).toContain('organizationLifecycleContributor')
  })
})
