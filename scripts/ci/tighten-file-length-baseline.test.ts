import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tightenCeilings } from './tighten-file-length-baseline'

describe('tightening file-length ceilings', () => {
  it('lowers a ceiling to the current size', () => {
    expect(tightenCeilings({ 'a.ts': 1524 }, { 'a.ts': 900 })).toEqual({ 'a.ts': 900 })
  })

  it('never raises a ceiling', () => {
    expect(tightenCeilings({ 'a.ts': 900 }, { 'a.ts': 1200 })).toEqual({ 'a.ts': 900 })
  })

  it('drops a file that is back under the common limit', () => {
    expect(tightenCeilings({ 'a.ts': 1524 }, { 'a.ts': 2 })).toEqual({})
    expect(tightenCeilings({ 'a.ts': 1524 }, { 'a.ts': 800 })).toEqual({})
  })

  it('drops a file that no longer exists', () => {
    expect(tightenCeilings({ 'gone.ts': 1000 }, {})).toEqual({})
  })

  it('rewrites current ESLint counts through a symlink without raising a ceiling', () => {
    const directory = mkdtempSync(join(tmpdir(), 'file length '))
    try {
      mkdirSync(join(directory, 'scripts/ci'), { recursive: true })
      symlinkSync(resolve('node_modules'), join(directory, 'node_modules'))
      writeFileSync(
        join(directory, 'eslint.config.mjs'),
        'export default [{ files: ["**/*.ts"] }]\n',
      )
      const baseline = join(directory, 'scripts/ci/file-length.baseline.json')
      writeFileSync(
        baseline,
        JSON.stringify({
          'shrunk.ts': 1000,
          'grown.ts': 900,
          'small.ts': 1000,
          'empty.ts': 1000,
          'gone.ts': 1000,
        }),
      )
      const code = (count: number) =>
        Array.from({ length: count }, (_, i) => `export const value${i} = ${i}\n`).join(
          '',
        )
      writeFileSync(join(directory, 'shrunk.ts'), `// comment\n\n${code(850)}`)
      writeFileSync(join(directory, 'grown.ts'), code(950))
      writeFileSync(join(directory, 'small.ts'), code(2))
      writeFileSync(join(directory, 'empty.ts'), '// comment only\n\n')
      const link = join(directory, 'tighten.ts')
      symlinkSync(resolve('scripts/ci/tighten-file-length-baseline.ts'), link)
      const run = () =>
        spawnSync(process.execPath, ['--import', 'tsx', link], {
          cwd: directory,
          encoding: 'utf8',
        })
      const result = run()
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('[file-length]')
      const expected = { 'grown.ts': 900, 'shrunk.ts': 850 }
      expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual(expected)
      expect(run().status).toBe(0)
      expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual(expected)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
