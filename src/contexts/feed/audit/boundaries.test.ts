import { ESLint } from 'eslint'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint()
const boundaryRules = new Set([
  'boundaries/dependencies',
  'boundaries/no-unknown-files',
  'boundaries/no-unknown-dependencies',
])

async function lint(source: string, file: string) {
  const [result] = await eslint.lintText(source, {
    filePath: resolve(process.cwd(), file),
  })
  if (!result) throw new Error(`ESLint returned no result for ${file}`)
  return result.messages
}

describe.each(['event', 'fact', 'read', 'write', 'retention'])(
  'audit %s server import boundaries',
  (module) => {
    const target = `#/contexts/feed/audit/${module}.server`
    const file = `src/contexts/feed/audit/${module}.server.ts`

    it('classifies the server module', async () => {
      const messages = await lint('export {}\n', file)
      expect(messages.filter(({ ruleId }) => boundaryRules.has(ruleId ?? ''))).toEqual([])
    })

    it.each([
      'src/contexts/feed/infrastructure/audit-boundary-fixture.ts',
      'src/contexts/feed/application/public-api.ts',
      'src/contexts/feed/server/audit-boundary-fixture.ts',
      'src/contexts/feed/build.ts',
      'src/contexts/feed/audit/boundary-fixture.server.ts',
    ])('allows the owning context server code in %s', async (origin) => {
      const messages = await lint(`import '${target}'\n`, origin)
      expect(messages.filter(({ ruleId }) => boundaryRules.has(ruleId ?? ''))).toEqual([])
    })

    it.each([
      'src/routes/audit-boundary-fixture.ts',
      'src/components/audit-boundary-fixture.ts',
      'src/shared/jobs/retention-sweep.job.ts',
      'src/contexts/review/infrastructure/audit-boundary-fixture.ts',
      'src/contexts/feed/feed/ui/audit-boundary-fixture.tsx',
      'src/contexts/feed/audit/ui/audit-boundary-fixture.tsx',
      'scripts/ops/audit-events.ts',
    ])('refuses a direct feature server import from %s', async (origin) => {
      const messages = await lint(`import '${target}'\n`, origin)
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ruleId: 'boundaries/dependencies' }),
        ]),
      )
    })

    it('allows SQL in the feature server module', async () => {
      expect(await lint("import 'drizzle-orm'\n", file)).toEqual([])
    })
  },
)

describe('audit public runtime seams', () => {
  it.each([
    ['src/composition/retention-rules.ts', 'getAuditEventRetentionRule'],
    ['scripts/ops/audit-events.ts', 'readAuditEvents'],
  ])('allows access through the Feed public API in %s', async (file, name) => {
    const messages = await lint(
      `import { ${name} } from '#/contexts/feed/application/public-api'\n`,
      file,
    )
    expect(messages.filter(({ ruleId }) => boundaryRules.has(ruleId ?? ''))).toEqual([])
  })

  it.each(['read', 'write'])('keeps React out of the %s command', async (module) => {
    const messages = await lint(
      "import { useState } from 'react'\n",
      `src/contexts/feed/audit/${module}.server.ts`,
    )
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'no-restricted-imports' }),
      ]),
    )
  })
})
