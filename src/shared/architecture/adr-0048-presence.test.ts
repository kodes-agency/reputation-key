// BQC-4.1: preserve the historical ADR and follow its explicit supersession
// pointer to the accepted current Data Cell routing authority.

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

  it('ADR 0048 points to accepted ADR 0054, which records current routing decisions', () => {
    const files = readdirSync(ADR_DIR).filter((f) => f.startsWith('0048-'))
    const historical = readFileSync(join(ADR_DIR, files[0]!), 'utf-8')
    expect(historical).toMatch(/status:\s*superseded/i)
    expect(historical).toMatch(/superseded_by:\s*0054/i)

    const currentFiles = readdirSync(ADR_DIR).filter((f) => f.startsWith('0054-'))
    expect(currentFiles.length, 'expected exactly one ADR 0054 file').toBe(1)
    const body = readFileSync(join(ADR_DIR, currentFiles[0]!), 'utf-8')
    expect(body).toMatch(/status:\s*accepted/i)
    expect(body).toContain('us')
    expect(body).toContain('europe')
    expect(body).toContain('global')
    expect(body).toMatch(/fail[s]?\s+closed|fails closed|fail closed/i)
    expect(body).toContain('credential-home cell')
    expect(body).toContain('routing directory')
    expect(body).toContain('Cross-cell fallback')
  })
})
