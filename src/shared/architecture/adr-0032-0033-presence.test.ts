// BQR-4.3 — ADR 0032/0033 accepted and aligned with production authorize/capability seams.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

describe('ADR 0032 / 0033 presence (BQR-4.3)', () => {
  it('ADR 0032 is accepted and does not list portal.read as core', () => {
    const path = join(ROOT, 'docs/adr/0032-beta-capability-and-cohort-controls.md')
    expect(existsSync(path)).toBe(true)
    const src = readFileSync(path, 'utf8')
    expect(src).toMatch(/status:\s*accepted/)
    expect(src).toContain('portal.read')
    // portal.read must be documented as non-core
    expect(src).toMatch(/portal\.read.*not.*core|not\*\* core|\*\*not\*\* core/i)
    expect(src).toContain('review.use')
    expect(src).toContain('inbox.use')
  })

  it('ADR 0033 is accepted and cites requireAuthorized', () => {
    const path = join(ROOT, 'docs/adr/0033-authorization-policy.md')
    expect(existsSync(path)).toBe(true)
    const src = readFileSync(path, 'utf8')
    expect(src).toMatch(/status:\s*accepted/)
    expect(src).toContain('requireAuthorized')
    expect(src).toContain('authorization-policy.ts')
  })
})
