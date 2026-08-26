import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walk } from '#/shared/testing/source-tree'

const ROOT = process.cwd()

describe('Recent Activity integrity-claim boundary', () => {
  it('contains no home-grown Operational Action History or row-hash implementation', () => {
    const offenders = walk(join(ROOT, 'src/contexts/activity'))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8')
        const banned = [
          /export\s+(?:interface|type)\s+AuditRecord\b/,
          /export\s+function\s+computeAuditHash\b/,
          /\bpreviousHash\b/,
          /\btamper-evident chain\b/i,
        ]
        return banned
          .filter((pattern) => pattern.test(source))
          .map((pattern) => `${file.replace(`${ROOT}/`, '')}: ${pattern.source}`)
      })

    expect(
      offenders,
      'Activity is a rebuildable Recent Activity projection. Restricted ' +
        'Operational Action History requires its own accepted design and must ' +
        'not be simulated with hashes stored beside mutable rows.',
    ).toEqual([])
  })

  it('does not describe the product projection as an audit log or audit trail', () => {
    const vocabularyFiles = [
      ...walk(join(ROOT, 'src/contexts/activity')),
      join(ROOT, 'src/bootstrap.ts'),
      join(ROOT, 'src/shared/events/schema-registrations.ts'),
    ]
    const offenders = vocabularyFiles
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8')
        return [/\baudit log\b/i, /\baudit trail\b/i]
          .filter((pattern) => pattern.test(source))
          .map((pattern) => `${file.replace(`${ROOT}/`, '')}: ${pattern.source}`)
      })

    expect(
      offenders,
      'Production code must call this projection Recent Activity. Audit language ' +
        'is reserved for the separately governed Operational Action History.',
    ).toEqual([])
  })
})
