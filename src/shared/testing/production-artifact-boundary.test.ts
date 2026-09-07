import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { assertLocalToolExecutionIdentity } from '../config/local-tool-execution'

const ROOT = process.cwd()
const temporaryRoots: string[] = []

function artifactRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'repkey-production-artifact-'))
  temporaryRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('production artifact boundary', () => {
  it('fails closed unless the host seed supplies its exact execution identity', () => {
    expect(() => assertLocalToolExecutionIdentity({})).toThrow(
      /e2e host execution identity/u,
    )
    expect(() =>
      assertLocalToolExecutionIdentity({
        LOCAL_TOOL_EXECUTION_IDENTITY: 'production',
      }),
    ).toThrow(/e2e host execution identity/u)
    expect(() =>
      assertLocalToolExecutionIdentity({
        LOCAL_TOOL_EXECUTION_IDENTITY: 'repkey-local-stack-v1',
      }),
    ).not.toThrow()
  })

  it('accepts a serving artifact without host-only tooling', () => {
    const root = artifactRoot()
    writeFileSync(join(root, 'index.js'), 'export const service = "worker"\n')

    expect(() =>
      execFileSync(
        process.execPath,
        [join(ROOT, 'scripts/check-production-artifacts.mjs'), root],
        { cwd: ROOT, stdio: 'pipe' },
      ),
    ).not.toThrow()
  })

  it.each([
    ['forbidden executable name', 'seed-e2e-user.js', 'export {}\n'],
    [
      'forbidden Google provisioner import',
      'index.js.map',
      JSON.stringify({
        sources: ['../scripts/ops/provision-google-admission-role.ts'],
      }),
    ],
    ['default credential', 'index.js', 'const password = "password123"\n'],
    [
      'CommonJS pino-pretty resolution in an ESM artifact',
      'index.mjs',
      "const pretty = require.resolve('pino-pretty')\n",
    ],
    [
      'Storybook source',
      'index.js.map',
      JSON.stringify({ sources: ['../src/components/ui/button.stories.tsx'] }),
    ],
  ])('rejects %s in a serving artifact', (_case, relativePath, contents) => {
    // @proof PRODUCTION_ARTIFACT_BOUNDARY#2
    const root = artifactRoot()
    const path = join(root, relativePath)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, contents)

    const result = spawnSync(
      process.execPath,
      [join(ROOT, 'scripts/check-production-artifacts.mjs'), root],
      { cwd: ROOT, encoding: 'utf8' },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Production artifact policy violation')
  })
})
