import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function checkArtifacts(...args: readonly string[]) {
  return spawnSync(
    process.execPath,
    [join(ROOT, 'scripts/check-production-artifacts.mjs'), ...args],
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

/** A bundle and the source map that names what was bundled into it. */
function bundleWithMap(directory: string, sources: readonly string[]): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'index.js'), 'export const service = "worker"\n')
  writeFileSync(join(directory, 'index.js.map'), JSON.stringify({ sources }))
}

// The six forbidden-source rules read source maps and nothing else, so a tree
// with no map passes them without their having looked at anything. That is
// what the image build gave them: it deleted every map in the command before
// the check. A caller that knows where maps must be says so.
describe('forbidden-source rules need a source map to read', () => {
  it('pass a tree with no map when none is required, and say they read none', () => {
    const root = artifactRoot()
    writeFileSync(join(root, 'index.js'), 'export const service = "worker"\n')

    const result = checkArtifacts(root)

    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/ files=1 source-maps=0\n$/u)
  })

  it('fail a required directory that holds no map', () => {
    const root = artifactRoot()
    writeFileSync(join(root, 'index.js'), 'export const service = "worker"\n')

    const result = checkArtifacts('--require-source-maps', root, root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'no source map names a source here, so the forbidden-source rules read nothing',
    )
  })

  it('fail a required directory whose only map names no source', () => {
    const root = artifactRoot()
    bundleWithMap(root, [])

    const result = checkArtifacts('--require-source-maps', root, root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('no source map names a source here')
  })

  it("hold each required directory to its own maps, not to a sibling's", () => {
    const root = artifactRoot()
    bundleWithMap(join(root, 'worker'), ['../src/worker/index.ts'])
    mkdirSync(join(root, 'client-source-maps'))

    const result = checkArtifacts(
      '--require-source-maps',
      join(root, 'worker'),
      '--require-source-maps',
      join(root, 'client-source-maps'),
      root,
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('client-source-maps: no source map names a source')
    expect(result.stderr).not.toContain('worker: no source map names a source')
  })

  it('accept required directories that each carry a map, and count what was read', () => {
    const root = artifactRoot()
    bundleWithMap(join(root, 'worker'), ['../src/worker/index.ts'])
    bundleWithMap(join(root, 'client-source-maps'), ['../src/client.tsx'])

    const result = checkArtifacts(
      '--require-source-maps',
      join(root, 'worker'),
      '--require-source-maps',
      join(root, 'client-source-maps'),
      root,
    )

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/ files=4 source-maps=2\n$/u)
  })

  it('refuse a requirement that names no directory', () => {
    const root = artifactRoot()
    bundleWithMap(root, ['../src/worker/index.ts'])

    const result = checkArtifacts(root, '--require-source-maps')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('--require-source-maps needs a directory')
  })
})

describe('where the builds run the artifact check', () => {
  const ARTIFACT_CHECK = 'scripts/check-production-artifacts.mjs'

  it('the image build reads the worker maps before it deletes them', () => {
    const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8')
    const withMaps = dockerfile.indexOf(
      `node ${ARTIFACT_CHECK} --require-source-maps dist-worker .output dist-worker`,
    )
    const deletion = dockerfile.indexOf("-name '*.map' -delete")
    const shipped = dockerfile.lastIndexOf(`node ${ARTIFACT_CHECK} .output dist-worker`)

    expect(withMaps).toBeGreaterThan(-1)
    expect(deletion).toBeGreaterThan(withMaps)
    // What ships is still checked after the deletion: the Nitro manifest must
    // not list a map the image no longer has.
    expect(shipped).toBeGreaterThan(deletion)
  })

  it('CI requires the client and worker maps on every commit', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')

    expect(workflow).toMatch(
      /pnpm check:production-artifacts\s+--require-source-maps \.output\/client-source-maps\s+--require-source-maps dist-worker\s+\.output\s+dist-worker\n/u,
    )
  })
})
