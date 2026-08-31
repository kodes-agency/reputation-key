import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walk } from '#/shared/testing/source-tree'

const ROOT = process.cwd()

describe('Recent Activity integrity-claim boundary', () => {
  it('contains no row-hash implementation or cryptographic integrity claim', () => {
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
      'Restricted Operational Action History has ordinary append-only database ' +
        'defenses and sequence readiness only; it must not be presented as ' +
        'cryptographic integrity or simulated with hashes beside mutable rows.',
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

  it('does not expose deprecated ActivityLog domain aliases', () => {
    const files = [
      join(ROOT, 'src/contexts/activity/domain/types.ts'),
      join(ROOT, 'src/contexts/activity/domain/constructors.ts'),
      join(ROOT, 'src/contexts/activity/application/public-api.ts'),
    ]
    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return [/\bActivityLog\b/u, /\bCreateActivityLogInput\b/u, /\bcreateActivityLog\b/u]
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${file.replace(`${ROOT}/`, '')}: ${pattern.source}`)
    })

    expect(offenders).toEqual([])
  })
})
