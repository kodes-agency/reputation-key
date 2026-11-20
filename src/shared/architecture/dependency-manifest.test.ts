// What package.json pins about the runtime and its optional tools.
//
// @types/node is versioned to a specific Node major; a newer major changes the
// typed API surface (new globals, changed fs/util/stream signatures) presented
// to tsc and eslint even though those APIs do not exist in the pinned runtime
// CI, Docker and production actually run: a tsc-green build that can throw at
// runtime. A Dependabot bump ("@types/node 22.20.1 -> 26.6.2", 2026-09-24)
// once landed four majors ahead of .nvmrc with nothing to catch it.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')
const read = (relative: string): string => readFileSync(resolve(ROOT, relative), 'utf8')

const manifest = JSON.parse(read('package.json')) as {
  dependencies?: Record<string, string>
  devDependencies: Record<string, string>
}

describe('the pinned Node runtime', () => {
  it('keeps @types/node on the same major as the pinned Node runtime', () => {
    const pinnedMajor = read('.nvmrc').trim().split('.')[0]
    const typesNode = manifest.devDependencies['@types/node']

    // An exact semver pin, not a range: a range would let a future install
    // resolve to a different major with nothing here to notice.
    expect(typesNode).toMatch(/^\d+\.\d+\.\d+$/u)
    expect(typesNode?.split('.')[0]).toBe(pinnedMajor)
  })
})

describe('logger dependency boundary', () => {
  it('keeps the optional pretty-printer out of production dependencies', () => {
    expect(manifest.dependencies?.['pino-pretty']).toBeUndefined()
    expect(manifest.devDependencies['pino-pretty']).toBe('13.1.3')
  })
})
