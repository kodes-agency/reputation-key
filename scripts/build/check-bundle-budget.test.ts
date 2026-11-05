import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'

const script = resolve(import.meta.dirname, '../check-bundle-budget.mjs')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function check(
  files: Record<string, string>,
  sources: Record<string, string[] | null> = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'bundle-budget-'))
  roots.push(root)
  const assets = join(root, 'assets')
  mkdirSync(assets)
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(assets, name), source)
    if (!name.endsWith('.js') || sources[name] === null) continue
    writeFileSync(
      join(assets, `${name}.map`),
      JSON.stringify({ version: 3, sources: sources[name] ?? ['../../src/app.ts'] }),
    )
  }
  const result = spawnSync(process.execPath, [script, assets], {
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  return { status: result.status, output: result.stdout + result.stderr }
}

function largeChunk(bytes: number) {
  // Incompressible data makes these artifact fixtures exceed the real ceilings.
  return `export default ${JSON.stringify(randomBytes(bytes).toString('base64'))};`
}

describe('production bundle budget gate', () => {
  it('budgets the entry as part of the initial closure', () => {
    const result = check({ 'index-app.js': largeChunk(90_000) })
    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain('initial closure (1 js + 0 css):')
  })

  it('sums the static closure and all CSS once, leaving dynamic imports lazy', () => {
    const files = {
      'index-app.js': 'import{a}from"./shared.js";import"./side.js";import("./lazy.js");',
      'shared.js': 'export{a}from"./leaf.js";',
      'side.js': 'import"./shared.js";',
      'leaf.js': 'export const a=1;',
      'lazy.js': 'export default "lazy";',
      'styles.css': 'body{color:red}',
    }
    const result = check(files)
    const initialBytes = Object.entries(files)
      .filter(([name]) => name !== 'lazy.js')
      .reduce((sum, [, source]) => sum + gzipSync(source).length, 0)

    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain(
      `initial closure (4 js + 1 css): ${initialBytes.toLocaleString('en-US')} B / 345,000 B gzip`,
    )
    expect(result.output).toContain('largest chunk outside the closure lazy.js:')
    expect(result.output).toContain('/ 128,000 B gzip')
  })

  it.each<{ name: string; files: Record<string, string>; failure: string }>([
    {
      name: 'entry in the initial closure',
      files: { 'index-app.js': largeChunk(360_000) },
      failure: 'initial static closure (1 js + 0 css):',
    },
    {
      name: 'initial closure',
      files: {
        'index-app.js': 'import"./first.js";import"./second.js";',
        'first.js': largeChunk(180_000),
        'second.js': largeChunk(180_000),
      },
      failure: 'initial static closure (3 js + 0 css):',
    },
    {
      name: 'CSS in the initial closure',
      files: { 'index-app.js': '', 'styles.css': `/*${largeChunk(350_000)}*/` },
      failure: 'closure member styles.css:',
    },
    {
      name: 'lazy chunk',
      files: { 'index-app.js': 'import("./lazy.js");', 'lazy.js': largeChunk(150_000) },
      failure: 'lazy chunk lazy.js:',
    },
  ])('fails and names the offending $name artifact', ({ files, failure }) => {
    const result = check(files)
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain(failure)
    expect(result.output).toContain('exceeds budget')
  })

  it('reports every chunk in an initial static cycle', () => {
    const result = check({
      'index-app.js': 'import"./first.js";',
      'first.js': 'export*from"./second.js";',
      'second.js': 'import"./first.js";',
    })
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain('static import cycle')
    expect(result.output).toContain('first.js ↔ second.js')
  })

  it('rejects a static self-import in the initial closure', () => {
    const result = check({ 'index-app.js': 'import"./index-app.js";' })
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain('static import cycle')
    expect(result.output).toContain('index-app.js')
  })

  it('retains cycle protection for vendor chunks outside first paint', () => {
    const result = check(
      {
        'index-app.js': 'import("./lazy.js");',
        'lazy.js': 'import"./vendor-lib.js";',
        'vendor-lib.js': 'import"./lazy.js";',
      },
      { 'vendor-lib.js': ['../../node_modules/lib/index.js'] },
    )
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain('lazy.js ↔ vendor-lib.js')
  })

  it('does not gate an application cycle outside the initial closure', () => {
    const result = check({
      'index-app.js': 'import("./lazy.js");',
      'lazy.js': 'import"./other.js";',
      'other.js': 'import"./lazy.js";',
    })
    expect(result.status, result.output).toBe(0)
  })

  it('ignores import-looking comments, strings, templates and regular expressions', () => {
    const result = check({
      'index-app.js': [
        '// import "./vendor-sentry-sdk.js";',
        '/* export{a}from"./vendor-sentry-sdk.js"; */',
        'const text=\'from"./vendor-sentry-sdk.js"\';',
        'const template=`import"./vendor-sentry-sdk.js"`;',
        String.raw`const pattern=/import".\/vendor-sentry-sdk.js"/;`,
        'import("./vendor-sentry-sdk.js");',
      ].join('\n'),
      'vendor-sentry-sdk.js': 'export const a=1;',
    })
    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain('initial closure (1 js + 0 css):')
  })

  it('keeps the Sentry SDK out of the initial static closure', () => {
    const result = check(
      {
        'index-app.js': 'import"./vendor-sentry-sdk.js";',
        'vendor-sentry-sdk.js': '',
      },
      { 'vendor-sentry-sdk.js': ['../../node_modules/@sentry/core/index.js'] },
    )
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain('vendor-sentry-sdk.js')
    expect(result.output).toContain('is in the initial closure')
  })

  it('detects Sentry sources in an entry with a default chunk name', () => {
    const result = check(
      { 'index-app.js': '' },
      {
        'index-app.js': [
          '../../../node_modules/.pnpm/@sentry+core/node_modules/@sentry/core/index.js',
        ],
      },
    )
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain('Sentry SDK is in the initial closure')
  })

  it('detects a lazy library cycle without a vendor chunk name', () => {
    const result = check(
      {
        'index-app.js': 'import("./chart.js");',
        'chart.js': 'import"./shared.js";',
        'shared.js': 'export*from"./chart.js";',
      },
      { 'chart.js': ['../../node_modules/recharts/index.js'] },
    )
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain('chart.js ↔ shared.js')
  })

  it('fails when source provenance is missing rather than skipping library checks', () => {
    const result = check({ 'index-app.js': '' }, { 'index-app.js': null })
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain('missing source map for index-app.js')
  })

  it('rejects an empty source map', () => {
    const result = check({ 'index-app.js': '' }, { 'index-app.js': [] })
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain('empty source map for index-app.js')
  })

  it('allows generated bundler helpers without input source maps', () => {
    const result = check(
      {
        'index-app.js':
          'import"./preload-helper-built.js";import"./rolldown-runtime-built.js";',
        'preload-helper-built.js': '',
        'rolldown-runtime-built.js': '',
      },
      { 'preload-helper-built.js': null, 'rolldown-runtime-built.js': null },
    )
    expect(result.status, result.output).toBe(0)
  })

  it('fails a missing static chunk instead of undercounting the closure', () => {
    const result = check({ 'index-app.js': 'export*from"./missing.js";' })
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain('index-app.js')
    expect(result.output).toContain('missing.js')
  })

  it.each<Record<string, string>>([{}, { 'index-one.js': '', 'index-two.js': '' }])(
    'fails when the build has no unique entry',
    (files) => {
      const result = check(files)
      expect(result.status, result.output).toBe(1)
      expect(result.output).toContain('expected exactly 1 entry chunk')
    },
  )
})
