import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain .mjs script without types
import { findGuardedDisables } from '../check-lint-suppressions.mjs'

const directive = (body: string) => ['eslint', 'disable'].join('-') + body

describe('guarded lint disables', () => {
  it.each([
    ['max-lines', `// ${directive(' max-lines')}`],
    ['next-line max-lines', `// ${directive('-next-line max-lines')}`],
    ['block max-lines', `/* ${directive(' max-lines */')}`],
    ['test-quality rule', `// ${directive('-next-line test-quality/no-skip')}`],
    ['component-server', `// ${directive(' source-policy/component-server')}`],
    ['among others', `// ${directive(' no-console, max-lines')}`],
    ['with a reason', `// ${directive(' max-lines -- too long')}`],
    ['multiline list', `/* ${directive(' no-console,\n max-lines */')}`],
    ['quoted rule', `/* ${directive(' "max-lines" */')}`],
    ['blanket', `/* ${directive(' */')}`],
    ['blanket line', `const a = 1 // ${directive('-line')}`],
  ])('fails on %s', (_name, source) => {
    expect(findGuardedDisables(`const x = 1\n${source}\n`)).toHaveLength(1)
  })

  it.each([
    ['another rule', `// ${directive('-next-line no-console')}`],
    ['other source-policy rule', `// ${directive(' source-policy/browser-server')}`],
    [
      'guarded name only in the reason',
      `// ${directive(' no-console -- not max-lines')}`,
    ],
    ['an enable comment', `/* ${['eslint', 'enable'].join('-')} max-lines */`],
    ['text in a string', `const text = '// ${directive(' max-lines')}'`],
  ])('allows %s', (_name, source) => {
    expect(findGuardedDisables(source)).toEqual([])
  })

  it('reports the line of the directive', () => {
    expect(findGuardedDisables(`a\nb\n// ${directive(' max-lines')}\n`)[0]?.line).toBe(3)
  })

  it.each(['max-lines', 'test-quality/checks', 'source-policy/component-server'])(
    'the command fails on a planted %s disable, including through a symlink',
    (rule) => {
      const directory = mkdtempSync(join(tmpdir(), 'lint suppressions '))
      try {
        expect(spawnSync('git', ['init', '--quiet', directory]).status).toBe(0)
        const fixture = join(directory, 'fixture.ts')
        const script = resolve('scripts/check-lint-suppressions.mjs')
        const link = join(directory, 'check.mjs')
        symlinkSync(script, link)
        writeFileSync(fixture, 'export const value = 1\n')
        expect(spawnSync('git', ['add', 'fixture.ts'], { cwd: directory }).status).toBe(0)
        const run = (path: string) =>
          spawnSync(process.execPath, [path], { cwd: directory, encoding: 'utf8' })
        expect(run(script).status).toBe(0)
        writeFileSync(fixture, `/* ${directive(` ${rule} */`)}\nexport const value = 1\n`)
        for (const path of [script, link]) {
          const result = run(path)
          expect(result.status).toBe(1)
          expect(result.stderr).toContain('fixture.ts:1')
        }
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
})
