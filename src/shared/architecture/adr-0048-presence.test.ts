// BQC-4.1: preserve the historical ADR and follow its explicit supersession
// pointer to the accepted current Data Cell routing authority.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const ADR_DIR = join(ROOT, 'docs', 'adr')
const ROOT_CONTEXT = join(ROOT, 'CONTEXT.md')

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

  it('follows the active single-US beta topology amendment through ADR 0057', () => {
    const foundation = readFileSync(
      join(ADR_DIR, '0054-data-cell-catalogue-and-routing.md'),
      'utf8',
    )
    expect(foundation).toContain('0057-single-us-beta-data-cell.md')

    const topology = readFileSync(
      join(ADR_DIR, '0057-single-us-beta-data-cell.md'),
      'utf8',
    )
    expect(topology).toMatch(/status:\s*accepted/i)
    expect(topology).toMatch(/exactly one production Data Cell/i)
    expect(topology).toContain('cell-us')
    expect(topology).toMatch(/`europe` and `global`[\s\S]*`denied`/i)

    const context = readFileSync(ROOT_CONTEXT, 'utf8')
    expect(context).toMatch(
      /\| 0057 \| Single US beta Data Cell\s+\| Single-cell beta topology/i,
    )
  })

  it('follows the dedicated-project and IaC source amendment through ADR 0058', () => {
    const topology = readFileSync(
      join(ADR_DIR, '0057-single-us-beta-data-cell.md'),
      'utf8',
    )
    expect(topology).toContain(
      '0058-dedicated-railway-projects-and-iac-source-promotion.md',
    )

    const release = readFileSync(
      join(ADR_DIR, '0058-dedicated-railway-projects-and-iac-source-promotion.md'),
      'utf8',
    )
    expect(release).toMatch(/status:\s*accepted/i)
    expect(release).toContain('reputation-key-us-beta')
    expect(release).toContain('reputation-key-us-beta-rehearsal')
    expect(release).toMatch(/exactly one Railway environment total/i)
    expect(release).toMatch(/\.railway\/railway\.ts` is the sole owner/i)
    expect(release).toMatch(/`railway service source connect`[^.]+prohibited/i)
    expect(release).toContain('railway config plan --out')
    expect(release).toContain('railway config apply --plan')
    expect(release).toContain('Railway CLI 5.45.2')
    expect(release).toContain('contract.releaseControllerSha256')
    expect(release).toContain('release.controllerSha256')
    expect(release).toMatch(/IaC digest alone is insufficient/i)

    const context = readFileSync(ROOT_CONTEXT, 'utf8')
    expect(context).toMatch(
      /\| 0058 \| Dedicated Railway Projects and IaC-Owned Source Promotion\s+\| Railway release isolation/i,
    )
  })
})
