import { Linter, type Linter as LinterTypes } from 'eslint'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
const { default: sourcePolicy } = await import(
  pathToFileURL(resolve('eslint-rules/source-policy.mjs')).href
)
const { default: fileLength }: { default: LinterTypes.Config[] } = await import(
  pathToFileURL(resolve('eslint-rules/file-length.mjs')).href
)

function messages(code: string, filename: string, rule: string) {
  return new Linter()
    .verify(
      code,
      [
        {
          files: ['**/*.{ts,tsx}'],
          languageOptions: { parser: tseslint.parser },
          plugins: { policy: sourcePolicy },
          rules: { [`policy/${rule}`]: 'error' },
        },
      ],
      { filename },
    )
    .map(({ messageId }) => messageId)
}

const component = 'src/components/features/property/policy-fixture.tsx'
const feature = 'src/contexts/property/results/ui/policy-fixture.tsx'

describe('source policy lint rules', () => {
  it.each([component, feature])('rejects server value couplings in %s', (filename) => {
    for (const code of [
      "import { update } from '#/contexts/property/server/properties'",
      "import type { Model } from '#/contexts/property/server/properties'; import { update } from '#/contexts/property/server/properties'",
      "import * as api from '#/contexts/property/server/properties'",
      "import '#/contexts/property/server/properties'",
      "export { update } from '#/contexts/property/server/properties'",
      "export * from '#/contexts/property/server/properties'",
      "const api = import('#/contexts/property/server/properties')",
      "const api = require('#/contexts/property/server/properties')",
    ])
      expect(messages(code, filename, 'component-server')).toEqual(['serverImport'])
  })

  it.each([component, feature])(
    'preserves type-only server contracts in %s',
    (filename) => {
      for (const code of [
        "import type { update } from '#/contexts/property/server/properties'",
        "import { type update } from '#/contexts/property/server/properties'",
        "export type { update } from '#/contexts/property/server/properties'",
        "export { type update } from '#/contexts/property/server/properties'",
      ])
        expect(messages(code, filename, 'component-server')).toEqual([])
    },
  )

  it('resolves relative server imports and keeps server-like sibling names', () => {
    expect(
      messages("import '../../server/properties'", feature, 'component-server'),
    ).toEqual(['serverImport'])
    expect(
      messages(
        "import '#/contexts/property/server-types'",
        component,
        'component-server',
      ),
    ).toEqual([])
  })

  it.each([
    'src/components/inbox/use-reply-actions.ts',
    'src/components/features/portal/link-tree/use-linktree-mutations.ts',
  ])('keeps the documented mutation hook %s', (filename) => {
    expect(
      messages(
        "import '#/contexts/property/server/properties'",
        filename,
        'component-server',
      ),
    ).toEqual([])
    expect(
      messages(
        "import '#/contexts/property/server/properties'",
        filename.replace(/\.ts$/, '-other.ts'),
        'component-server',
      ),
    ).toEqual(['serverImport'])
  })

  it.each([component, feature, 'src/routes/_authenticated/policy-fixture.tsx'])(
    'rejects a server-only helper in browser source %s',
    (filename) => {
      expect(
        messages("import '#/shared/helper.server'", filename, 'browser-server'),
      ).toEqual(['serverOnly'])
      expect(
        messages("export * from '#/shared/helper.server.ts'", filename, 'browser-server'),
      ).toEqual(['serverOnly'])
      expect(
        messages(
          "import type { Model } from '#/shared/helper.server'",
          filename,
          'browser-server',
        ),
      ).toEqual([])
    },
  )

  it.each([
    'src/components/features/settings/policy-fixture.tsx',
    'src/contexts/feed/preferences/ui/policy-fixture.tsx',
  ])('refuses a planted Feed preference server import in %s', (filename) => {
    for (const code of [
      "import { createNotificationUserSettings } from '#/contexts/feed/preferences/user-settings.server'",
      "import { muteNotificationCategory } from '../mute-category.server'",
    ])
      expect(messages(code, filename, 'browser-server')).toEqual(['serverOnly'])
    expect(
      messages(
        "import { notificationUserSettingsDto } from '#/contexts/feed/preferences/contracts'",
        filename,
        'browser-server',
      ),
    ).toEqual([])
  })

  it('preserves only the named browser configuration RPC at the root route', () => {
    const target = '#/shared/observability/browser-observability.server'
    expect(
      messages(
        `import { getBrowserObservabilityConfigFn } from '${target}'`,
        'src/routes/__root.tsx',
        'browser-server',
      ),
    ).toEqual([])
    expect(
      messages(
        `import { plainHelper } from '${target}'`,
        'src/routes/__root.tsx',
        'browser-server',
      ),
    ).toEqual(['serverOnly'])
    expect(
      messages(
        `import * as config from '${target}'`,
        'src/routes/__root.tsx',
        'browser-server',
      ),
    ).toEqual(['serverOnly'])
  })

  it.each([
    feature,
    'src/contexts/review/server/reply.ts',
    'src/routes/api/policy-fixture.ts',
  ])('rejects worker system scope in request path %s', (filename) => {
    expect(
      messages("import '#/shared/db/system-scope.server'", filename, 'system-scope'),
    ).toEqual(['workerOnly'])
  })

  it.each([
    'src/worker/index.ts',
    'src/shared/jobs/example.ts',
    'scripts/ops/example.ts',
  ])('keeps worker/operator system scope in %s', (filename) => {
    expect(
      messages("import '#/shared/db/system-scope.server'", filename, 'system-scope'),
    ).toEqual([])
  })

  it('keeps the component filename exceptions and rejects a new PascalCase filename', () => {
    expect(messages('', 'src/components/BadName.tsx', 'component-filename')).toEqual([
      'filename',
    ])
    for (const name of [
      'index.ts',
      'policy-fixture.tsx',
      'hooks/use-legacyName.ts',
      'policy-fixture.test.tsx',
      'policy-fixture.stories.support.tsx',
    ]) {
      expect(messages('', `src/components/${name}`, 'component-filename')).toEqual([])
    }
  })
})

const codeLines = (count: number) =>
  Array.from({ length: count }, (_, i) => `export const value${i} = ${i}`).join('\n')
function lengthMessages(filename: string, code: string) {
  return new Linter()
    .verify(
      code,
      [
        { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } },
        ...fileLength,
      ],
      { filename },
    )
    .map(({ ruleId }) => ruleId)
}

describe('common ESLint file-length limit', () => {
  it.each([
    component,
    feature,
    'src/components/ui/policy-fixture.tsx',
    'src/shared/example.ts',
    'scripts/example.ts',
    'server/example.ts',
  ])('rejects 801 code lines in %s', (filename) => {
    expect(lengthMessages(filename, codeLines(801))).toEqual(['max-lines'])
    expect(
      lengthMessages(filename, `${codeLines(800)}\n\n// comment\n/* comment */`),
    ).toEqual([])
  })

  it('retains the existing no-growth exception for an oversized module', () => {
    const filename = 'src/shared/events/schema-registrations.ts'
    expect(lengthMessages(filename, codeLines(1524))).toEqual([])
    expect(lengthMessages(filename, codeLines(1525))).toEqual(['max-lines'])
  })

  it.each([
    'src/shared/example.test.ts',
    'src/components/example.stories.tsx',
    'src/shared/generated/example.ts',
    'src/routeTree.gen.ts',
  ])('excludes fixtures/generated source %s', (filename) => {
    expect(lengthMessages(filename, codeLines(801))).toEqual([])
  })
})
