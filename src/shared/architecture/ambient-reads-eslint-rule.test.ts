// BQC-5.3 + WP1.2: domain code never reads the wall clock (ADR 0017), and
// routes and contexts never read process.env. Both bans are `no-restricted-syntax`
// selectors, and ESLint flat config replaces a rule's options rather than
// merging them: the process.env block once dropped the wall-clock selectors for
// every src/contexts/*/domain/** file.
//
// Drives the real eslint.config.js through the programmatic ESLint API, so the
// test covers both the selectors and the files each block reaches.

import { ESLint } from 'eslint'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RULE_ID = 'no-restricted-syntax'
const eslint = new ESLint()

const AMBIENT_READS = `export const createdAt = new Date()
export const elapsed = Date.now()
export const region = process.env.REGION
`

async function restrictedLines(code: string, relativePath: string) {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(process.cwd(), relativePath),
  })
  // A missing result must fail loudly, not read as "no violations".
  if (!result) throw new Error(`ESLint returned no result for ${relativePath}`)
  return result.messages
    .filter(({ ruleId }) => ruleId === RULE_ID)
    .map(({ line }) => line)
}

describe('ambient clock and configuration reads', () => {
  it('rejects wall-clock and process.env reads in context domain code', async () => {
    const lines = await restrictedLines(
      AMBIENT_READS,
      'src/contexts/review/domain/ambient-reads-fixture.ts',
    )

    expect(lines).toEqual([1, 2, 3])
  })

  it('rejects wall-clock reads in shared domain code', async () => {
    const lines = await restrictedLines(
      'export const createdAt = new Date()\nexport const elapsed = Date.now()\n',
      'src/shared/domain/ambient-reads-fixture.ts',
    )

    expect(lines).toEqual([1, 2])
  })

  it('rejects only process.env reads in context application code and routes', async () => {
    const application = await restrictedLines(
      AMBIENT_READS,
      'src/contexts/review/application/ambient-reads-fixture.ts',
    )
    const route = await restrictedLines(
      AMBIENT_READS,
      'src/routes/ambient-reads-fixture.ts',
    )

    expect(application).toEqual([3])
    expect(route).toEqual([3])
  })

  it('accepts time passed in as a parameter', async () => {
    const lines = await restrictedLines(
      'export const copy = (now: Date) => new Date(now.getTime())\n',
      'src/contexts/review/domain/ambient-reads-fixture.ts',
    )

    expect(lines).toEqual([])
  })

  it('exempts test files', async () => {
    const lines = await restrictedLines(
      AMBIENT_READS,
      'src/contexts/review/domain/ambient-reads-fixture.test.ts',
    )

    expect(lines).toEqual([])
  })
})
