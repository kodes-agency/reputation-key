import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { afterEach, describe, expect, it } from 'vitest'
import {
  countCodeLines,
  isProductionModule,
  MAX_LINES,
  measureFileLengths,
} from './check-file-length'
import { compareWithBaseline, parseBaseline } from './ratchet-baseline'

const ROOT = resolve(import.meta.dirname, '../..')

// Every construct that makes comment detection hard, with its expected verdict.
const FIXTURE = [
  '#!/usr/bin/env node', // skipped: ESLint reads a shebang as a comment
  '// leading comment', // skipped
  '', // skipped
  '/**', // skipped
  ' * A block comment', // skipped
  ' */', // skipped
  "import { thing } from './thing' // trailing comment", // counted
  '/* one-line block */', // skipped
  "const url = 'https://example.com/*not-a-comment*/'", // counted
  'const template = `', // counted
  '// inside a template, so not a comment', // counted
  '${thing /* comment inside an expression */}', // counted
  '`', // counted
  'const pattern = /\\/\\/ not a comment/u', // counted
  'const ratio = 4 / 2 // division, then a comment', // counted
  'export const View = () => (', // counted
  '  <p>', // counted
  '    // JSX text, so not a comment', // counted
  '    {/* the braces are code */}', // counted
  '  </p>', // counted
  ')', // counted
  '/* a block', // skipped
  '   over three', // skipped
  '   lines */ const after = 1', // counted
].join('\n')

const FIXTURE_COUNTED_LINES = 15

/** Does ESLint's own max-lines rule report `text` as longer than `max`? */
function eslintExceeds(max: number, fileName: string, text: string): boolean {
  const messages = new Linter().verify(
    text,
    [
      {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: {
          'max-lines': ['error', { max, skipBlankLines: true, skipComments: true }],
        },
      },
    ],
    { filename: fileName },
  )
  return messages.some((message) => message.ruleId === 'max-lines')
}

const codeLines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `export const v${index} = ${index}`).join(
    '\n',
  )

describe('file-length counting', () => {
  it('skips blank and comment-only lines and nothing else', () => {
    expect(countCodeLines('fixture.tsx', FIXTURE)).toBe(FIXTURE_COUNTED_LINES)
  })

  it('agrees with ESLint max-lines (skipBlankLines + skipComments)', () => {
    const counted = countCodeLines('fixture.tsx', FIXTURE)

    expect(eslintExceeds(counted - 1, 'fixture.tsx', FIXTURE)).toBe(true)
    expect(eslintExceeds(counted, 'fixture.tsx', FIXTURE)).toBe(false)
  })

  it('treats tests, stories, generated code and the route tree as non-production', () => {
    expect(isProductionModule('src/shared/db/pool.ts')).toBe(true)
    expect(isProductionModule('src/routes/index.tsx')).toBe(true)
    expect(isProductionModule('src/shared/db/pool.test.ts')).toBe(false)
    expect(isProductionModule('src/routes/page.stories.tsx')).toBe(false)
    expect(isProductionModule('src/shared/generated/table.ts')).toBe(false)
    expect(isProductionModule('src/routeTree.gen.ts')).toBe(false)
    expect(isProductionModule('scripts/check-filenames.mjs')).toBe(false)
  })
})

describe('file-length ratchet', () => {
  let root: string | undefined

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = undefined
  })

  function repository(files: Readonly<Record<string, string>>): string {
    const directory = mkdtempSync(join(tmpdir(), 'repkey-file-length-'))
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, path)), { recursive: true })
      writeFileSync(join(directory, path), text)
    }
    return directory
  }

  it(`fails a new production module past ${MAX_LINES} counted lines`, () => {
    root = repository({
      'src/shared/over.ts': codeLines(MAX_LINES + 1),
      'src/shared/at-limit.ts': codeLines(MAX_LINES),
      'src/shared/padded.ts': `${codeLines(MAX_LINES)}${'\n\n// free\n/* free */'.repeat(50)}`,
      'src/shared/over.test.ts': codeLines(MAX_LINES + 1),
      'src/routes/over.stories.tsx': codeLines(MAX_LINES + 1),
      'src/shared/generated/over.ts': codeLines(MAX_LINES + 1),
      'src/components/over.tsx': codeLines(MAX_LINES + 1),
      'docs/over.ts': codeLines(MAX_LINES + 1),
    })

    const current = measureFileLengths(root)

    expect(current).toEqual({ 'src/shared/over.ts': MAX_LINES + 1 })
    expect(compareWithBaseline({}, current).regressions).toEqual([
      { file: 'src/shared/over.ts', baseline: 0, current: MAX_LINES + 1 },
    ])
  })

  it('fails a grandfathered module that grows', () => {
    root = repository({ 'scripts/big.ts': codeLines(MAX_LINES + 2) })

    expect(
      compareWithBaseline({ 'scripts/big.ts': MAX_LINES + 1 }, measureFileLengths(root))
        .regressions,
    ).toEqual([
      { file: 'scripts/big.ts', baseline: MAX_LINES + 1, current: MAX_LINES + 2 },
    ])
  })

  it('passes on the current tree against the committed baseline', () => {
    const baseline = parseBaseline(
      readFileSync(resolve(ROOT, 'scripts/ci/file-length.baseline.json'), 'utf8'),
    )

    const current = measureFileLengths(ROOT)

    expect(compareWithBaseline(baseline, current).regressions).toEqual([])
  })
})
