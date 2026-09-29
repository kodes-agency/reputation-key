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

/**
 * A Nitro output as the node-server preset bundles it: the public-asset
 * manifest is inlined into a server chunk, each entry's `path` relative to
 * `server/`. Nitro answers a listed id by reading that path.
 */
function nitroOutput(
  listedIds: readonly string[],
  publicFiles: readonly string[],
  manifestChunk = true,
): string {
  const root = artifactRoot()
  mkdirSync(join(root, 'server'), { recursive: true })
  const assets = Object.fromEntries(
    listedIds.map((id) => [id, { type: 'text/javascript', path: `../public${id}` }]),
  )
  const manifest = manifestChunk
    ? [
        '//#region #nitro/virtual/public-assets-data',
        `var public_assets_data_default = ${JSON.stringify(assets, null, '\t')};`,
        '//#endregion',
      ].join('\n')
    : ''
  writeFileSync(join(root, 'server/index.mjs'), `${manifest}\nexport {}\n`)
  for (const file of publicFiles) {
    mkdirSync(join(root, 'public', file, '..'), { recursive: true })
    writeFileSync(join(root, 'public', file), 'export {}\n')
  }
  mkdirSync(join(root, 'public'), { recursive: true })
  return root
}

function checkArtifacts(root: string) {
  return spawnSync(
    process.execPath,
    [join(ROOT, 'scripts/check-production-artifacts.mjs'), root],
    { cwd: ROOT, encoding: 'utf8' },
  )
}

describe('Nitro public-asset manifest', () => {
  it('accepts a manifest whose every entry exists in the public directory', () => {
    const root = nitroOutput(
      ['/assets/app.js', '/robots.txt'],
      ['assets/app.js', 'robots.txt'],
    )

    const result = checkArtifacts(root)

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('rejects an entry whose file the build deleted, which Nitro would answer with a 500', () => {
    // The 2026-09-29 alert burst: client source maps were listed, then deleted.
    const root = nitroOutput(['/assets/app.js', '/assets/app.js.map'], ['assets/app.js'])

    const result = checkArtifacts(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'public asset /assets/app.js.map is listed but ../public/assets/app.js.map does not exist',
    )
  })

  it('fails closed when a Nitro output carries no readable public-asset manifest', () => {
    const root = nitroOutput([], ['assets/app.js'], false)

    const result = checkArtifacts(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('no Nitro public-asset manifest found')
  })
})
