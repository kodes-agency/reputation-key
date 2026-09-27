// Guards the Node-runtime-vs-@types/node alignment. Fixed once (2026-08-26,
// 1c4928c92 "align pinned runtime surface") by a fuller pinned-runtime suite,
// then lost when that suite was cut wholesale in 12f6a17a7 ("cut the test
// suite to the BETA.md-derived keep-list"). With no assertion left, #604's
// Dependabot bump ("@types/node 22.20.1 -> 26.6.2", 2026-09-24) landed clean:
// four majors ahead of the Node this repo actually runs (.nvmrc, engines.node,
// every Dockerfile) with nothing to catch it. @types/node is versioned to a
// specific Node major; a newer major changes the typed API surface (new
// globals, changed fs/util/stream signatures) presented to tsc and eslint
// even though those APIs do not exist in the pinned runtime CI, Docker, and
// production actually run — a tsc-green build that can throw at runtime.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')
const read = (relative: string): string => readFileSync(resolve(ROOT, relative), 'utf8')

describe('the pinned Node runtime', () => {
  it('keeps @types/node on the same major as the pinned Node runtime', () => {
    const pinnedMajor = read('.nvmrc').trim().split('.')[0]
    const manifest = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>
    }
    const typesNode = manifest.devDependencies['@types/node']

    // An exact semver pin, not a range: a range would let a future install
    // resolve to a different major with nothing here to notice.
    expect(typesNode).toMatch(/^\d+\.\d+\.\d+$/u)
    expect(typesNode.split('.')[0]).toBe(pinnedMajor)
  })
})
