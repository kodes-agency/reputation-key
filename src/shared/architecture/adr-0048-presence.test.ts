// BQC-4.1: ADR 0048 must exist and remain the cited authority for
// property-region routing decisions (phase BQC-4 §3): supported region
// identifiers, resolution precedence, locked transitions, fail-closed
// behavior, and routing-policy versioning.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const ADR_DIR = join(ROOT, 'docs', 'adr')

describe('BQC-4.1: ADR 0048 property region routing', () => {
  it('has docs/adr/0048-*.md on disk', () => {
    const files = readdirSync(ADR_DIR).filter(
      (f) => f.startsWith('0048-') && f.endsWith('.md'),
    )
    expect(files.length, 'expected exactly one ADR 0048 file').toBe(1)
  })

  it('ADR 0048 is accepted and records the routing decisions', () => {
    const files = readdirSync(ADR_DIR).filter((f) => f.startsWith('0048-'))
    const body = readFileSync(join(ADR_DIR, files[0]!), 'utf-8')
    expect(body).toMatch(/status:\s*accepted/i)
    // region identifiers + beta approval state
    expect(body).toContain('us')
    expect(body).toContain('europe')
    expect(body).toContain('global')
    expect(body).toContain('unresolved')
    // global is a denied placeholder, europe denied until evidence passes
    expect(body).toMatch(/denied placeholder/i)
    // fail closed — never another region (ADR 0031)
    expect(body).toMatch(/fail[s]?\s+closed|fails closed|fail closed/i)
    // resolution precedence: google_address > manual > organization_default
    expect(body).toContain('google_address')
    expect(body).toContain('organization_default')
    // routing-policy version bumps on every resolution change
    expect(body).toContain('routing_policy_version')
  })
})
