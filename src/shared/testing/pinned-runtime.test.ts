// The runtime pin has to agree in five places or it is not a pin. `.nvmrc` is
// the source of truth; this file is what stops the others drifting from it.
//
// The failure that motivated it: the repo declared `engines.node: ">=22.0.0"`
// while CI installed exactly 22.23.2, so a local Node 26 satisfied package.json
// and then broke the local-stack orchestrator with `ENOBUFS` mid-boot — after
// the containers were up, with the diagnostics collector failing the same way.
// Nothing in the repo could have caught that, because nothing compared the
// declared floor to the version CI actually runs.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PINNED_ICU_VERSION,
  PINNED_UNICODE_VERSION,
  pinnedNodeVersion,
  pinnedRuntimeDrift,
} from './pinned-runtime'

const ROOT = resolve(import.meta.dirname, '../../..')
const read = (relative: string): string => readFileSync(resolve(ROOT, relative), 'utf8')

describe('the pinned runtime', () => {
  const pinned = pinnedNodeVersion(ROOT)

  it('names an exact version in .nvmrc', () => {
    // A range here would let every consumer below resolve to something else.
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('pins both runtime manifests exactly and keeps Node types on that major', () => {
    const manifest = JSON.parse(read('package.json')) as {
      engines: { node: string }
      devDependencies: Record<string, string>
    }
    const runtimeManifest = JSON.parse(read('package.runtime.json')) as {
      engines: { node: string }
    }

    expect(manifest.engines.node).toBe(pinned)
    expect(runtimeManifest.engines.node).toBe(pinned)
    expect(manifest.devDependencies['@types/node']).toMatch(/^\d+\.\d+\.\d+$/u)
    expect(manifest.devDependencies['@types/node']?.split('.')[0]).toBe(
      pinned.split('.')[0],
    )
  })

  it('does not install a host-specific build binding as a production dependency', () => {
    const manifest = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>
    }

    expect(manifest.dependencies['@rolldown/binding-darwin-arm64']).toBeUndefined()
  })

  it('uses neither engine-strict nor a preinstall guard — both were measured wrong', () => {
    const manifest = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>
    }
    // engine-strict also hard-enforces os/cpu metadata and previously failed
    // Linux jobs while a host-specific binding was installed directly. A
    // preinstall guard died inside the Docker deps stages (they COPY only
    // package.json + the lockfile) and does not fire at all for a developer
    // whose node_modules is already current.
    // .npmrc records both findings; this keeps them from being re-added.
    expect(read('.npmrc')).not.toMatch(/^engine-strict=true$/m)
    expect(manifest.scripts.preinstall).toBeUndefined()
  })

  it('is asserted where a wrong runtime silently corrupts work', () => {
    // The local-stack orchestrator is the one entry point that MUST refuse:
    // spawnSync fails ENOBUFS mid-boot there, after the containers are up.
    const stack = read('scripts/local-stack/stack.ts')
    expect(stack).toContain(
      "import { assertPinnedRuntime } from '../../src/shared/testing/pinned-runtime'",
    )
    expect(stack).toMatch(
      /async function main\(\): Promise<void> \{[\s\S]{0,400}?assertPinnedRuntime\(ROOT\)/,
    )
  })
  it.each(['.github/workflows/ci.yml', '.github/workflows/simulation.yml'])(
    '%s resolves the runtime from .nvmrc, with no literal left behind',
    (workflow) => {
      const yaml = read(workflow)
      expect(yaml).toContain('node-version-file: .nvmrc')
      // The literal is what drifts: seven copies of it existed before this.
      expect(yaml).not.toMatch(/node-version: *\d/)
    },
  )

  it('agrees with the runtime fence the test-quality gate enforces', () => {
    // scripts/check-test-quality.mjs cannot import this module (it is .mjs and
    // sits outside the TS projects), so its PINNED_RUNTIME is a second copy.
    // This is the assertion that keeps the copy honest.
    const gate = read('scripts/check-test-quality.mjs')
    const match =
      /const PINNED_RUNTIME = \{ node: '([^']+)', icu: '([^']+)', unicode: '([^']+)' \}/.exec(
        gate,
      )
    expect(match).not.toBeNull()
    expect(match?.[1]).toBe(pinned)
    expect(match?.[2]).toBe(PINNED_ICU_VERSION)
    expect(match?.[3]).toBe(PINNED_UNICODE_VERSION)
  })

  it('is asserted at build time by every service image', () => {
    // The Dockerfiles cannot read .nvmrc (no build context at that layer), so
    // each carries the assert inline. Every one must name this same version.
    const dockerfiles = [
      'Dockerfile',
      'Dockerfile.worker',
      'Dockerfile.google-import-compatibility',
      'Dockerfile.google-execution-admission',
      'Dockerfile.google-egress-gateway',
      'Dockerfile.ai-execution-admission',
      'Dockerfile.ai-egress-gateway',
      'Dockerfile.perf-runner',
      'Dockerfile.sandbox',
    ]
    for (const file of dockerfiles) {
      const text = read(file)
      expect(text, `${file} must assert the pinned runtime`).toContain(
        `node:'${pinned}',icu:'${PINNED_ICU_VERSION}',unicode:'${PINNED_UNICODE_VERSION}'`,
      )
    }
  })

  it('reports no drift on the runtime this suite is running under', () => {
    // Vitest runs under the same Node the developer/CI selected, so a green
    // suite is itself proof the pin resolved.
    expect(pinnedRuntimeDrift(ROOT)).toBeNull()
  })
})
