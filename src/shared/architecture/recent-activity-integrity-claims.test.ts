// Restricted Operational Action History has ordinary append-only database
// defenses and sequence readiness only. It must not be presented as
// cryptographic integrity or simulated with hashes beside mutable rows.

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walk } from '#/shared/testing/source-tree'

const ROOT = process.cwd()

const INTEGRITY_CLAIMS = [
  /export\s+(?:interface|type)\s+AuditRecord\b/,
  /export\s+function\s+computeAuditHash\b/,
  /\bpreviousHash\b/,
  /\btamper-evident chain\b/i,
] as const

const claims = (source: string) =>
  INTEGRITY_CLAIMS.filter((pattern) => pattern.test(source))

describe('Recent Activity integrity-claim boundary', () => {
  it('recognises a planted row-hash chain', () => {
    expect(claims('export function computeAuditHash(row, previousHash) {}')).toHaveLength(
      2,
    )
  })

  it('contains no row-hash implementation or cryptographic integrity claim', () => {
    const offenders = walk(join(ROOT, 'src/contexts/feed'))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .flatMap((file) =>
        claims(readFileSync(file, 'utf8')).map(
          (pattern) => `${relative(ROOT, file)}: ${pattern.source}`,
        ),
      )

    expect(offenders).toEqual([])
  })
})
