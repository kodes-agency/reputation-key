import { Linter } from 'eslint'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'

const { default: plugin } = await import(
  pathToFileURL(resolve('eslint-rules/test-quality.mjs')).href
)
function messages(source: string, filename: string) {
  return new Linter()
    .verify(
      source,
      [
        {
          files: ['**/*.{ts,tsx}'],
          languageOptions: { parser: tseslint.parser },
          plugins: { quality: plugin },
          rules: { 'quality/checks': 'error' },
        },
      ],
      { filename },
    )
    .map(({ ruleId, severity }) => ({ ruleId, severity }))
}

const focus = ['it', 'concurrent', 'only'].join('.')
const disabled = ['test', 'skip'].join('.')
const broadError = ['toThrow', '()'].join('')
const rejects = ['rejects', 'toBeDefined()'].join('.')

describe('test quality ESLint gate', () => {
  it.each([
    'src/example.test.ts',
    'scripts/ci/example.test.ts',
    'server/example.test.ts',
    'services/example.test.ts',
    '.storybook/example.stories.tsx',
    'e2e/example.metrics.ts',
  ])('rejects focused and disabled tests and broad assertions in %s', (filename) => {
    for (const source of [
      `${focus}('case', () => {})`,
      `${disabled}('case', () => {})`,
      `expect(run()).${broadError}`,
      `await expect(run()).${rejects}`,
    ]) {
      expect(messages(source, filename)).toEqual([
        { ruleId: 'quality/checks', severity: 2 },
      ])
    }
  })

  it('keeps a precise failure assertion and an explicit success assertion', () => {
    expect(
      messages(
        "expect(run()).toThrow('unavailable'); expect(ok).not.toThrow()",
        'src/example.test.ts',
      ),
    ).toEqual([])
  })

  it('keeps the registered runtime fence count and rejects an extra skip', () => {
    const filename = 'src/shared/ai-reply-template-catalogue.test.ts'
    const source = `${['it', 'runIf'].join('.')}(ready)('case', () => {})`
    expect(messages(source, filename)).toEqual([])
    expect(messages(`${source}\n${source}`, filename)).toEqual([
      { ruleId: 'quality/checks', severity: 2 },
    ])
  })
})
