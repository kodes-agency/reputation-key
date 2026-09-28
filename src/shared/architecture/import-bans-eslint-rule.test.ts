// The global `no-restricted-imports` block bans drizzle-orm (use repository
// ports) and React (business logic stays framework-free) in every src/** file.
// ESLint flat config replaces a rule's options rather than merging them, so
// each block that sets its own `no-restricted-imports` must carry those bans
// forward: the domain, application and shared/events blocks once dropped both,
// and the routes/components React allowance dropped the drizzle ban.
//
// Drives the real eslint.config.js through the programmatic ESLint API, so the
// test covers both the patterns and the files each block reaches.

import { ESLint } from 'eslint'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RULE_ID = 'no-restricted-imports'
const eslint = new ESLint()

const FRAMEWORK_IMPORTS = `import { eq } from 'drizzle-orm'
import { useState } from 'react'
export const refs = [eq, useState]
`

async function restrictedLines(relativePath: string) {
  const [result] = await eslint.lintText(FRAMEWORK_IMPORTS, {
    filePath: path.join(process.cwd(), relativePath),
  })
  // A missing result must fail loudly, not read as "no violations".
  if (!result) throw new Error(`ESLint returned no result for ${relativePath}`)
  return result.messages
    .filter(({ ruleId }) => ruleId === RULE_ID)
    .map(({ line }) => line)
}

describe('drizzle and React import bans', () => {
  it.each([
    'src/contexts/review/domain/import-bans-fixture.ts',
    'src/contexts/review/application/import-bans-fixture.ts',
    'src/shared/events/import-bans-fixture.ts',
    'src/contexts/review/server/import-bans-fixture.ts',
  ])('rejects both in %s', async (file) => {
    expect(await restrictedLines(file)).toEqual([1, 2])
  })

  it.each([
    'src/routes/import-bans-fixture.tsx',
    'src/components/import-bans-fixture.tsx',
  ])('allows React but not drizzle in %s', async (file) => {
    expect(await restrictedLines(file)).toEqual([1])
  })

  it('allows drizzle in context infrastructure', async () => {
    expect(
      await restrictedLines('src/contexts/review/infrastructure/import-bans-fixture.ts'),
    ).toEqual([])
  })

  it('exempts test files', async () => {
    expect(
      await restrictedLines('src/contexts/review/domain/import-bans-fixture.test.ts'),
    ).toEqual([])
  })
})
