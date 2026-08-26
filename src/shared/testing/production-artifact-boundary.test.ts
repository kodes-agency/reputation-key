import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { assertLocalToolExecutionIdentity } from '../config/local-tool-execution'

const ROOT = process.cwd()
const temporaryRoots: string[] = []

function projectFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

function serviceBlock(compose: string, name: string): string {
  const marker = new RegExp(`^  ${name}:\\n`, 'mu').exec(compose)
  if (!marker) throw new Error(`missing Compose service ${name}`)
  const start = marker.index
  const tail = compose.slice(start + marker[0].length)
  const nextService = /\n {2}[a-z0-9][a-z0-9-]*:\n/u.exec(tail)
  return compose.slice(
    start,
    nextService === null ? compose.length : start + marker[0].length + nextService.index,
  )
}

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
  it('keeps local-only executables outside the production worker bundle', () => {
    const productionConfig = projectFile('tsup.config.ts')
    const localToolsConfig = projectFile('tsup.local-tools.config.ts')

    expect(productionConfig).not.toMatch(
      /seed-e2e-user|provision-(?:ai|google)-admission-role/u,
    )
    expect(localToolsConfig).toContain("'seed-e2e-user': 'scripts/seed-e2e-user.ts'")
    expect(localToolsConfig).toMatch(
      /'provision-ai-admission-role':\s*'scripts\/local-stack\/provision-ai-admission-role\.ts'/u,
    )
    expect(localToolsConfig).toMatch(
      /'provision-google-admission-role':\s*'scripts\/ops\/provision-google-admission-role\.ts'/u,
    )
    expect(localToolsConfig).toContain("outDir: 'dist-local-tools'")
  })

  it('runs local one-shot services from the isolated local-tools image', () => {
    const compose = projectFile('compose.local.yml')
    const seed = serviceBlock(compose, 'seed')
    const admissionRole = serviceBlock(compose, 'ai-admission-role')
    const googleAdmissionRole = serviceBlock(compose, 'google-admission-role')

    expect(compose).toContain('x-local-tools-image: &local-tools-image')
    expect(seed).toContain('*local-tools-image')
    expect(seed).toContain('dist-local-tools/seed-e2e-user.js')
    expect(admissionRole).toContain('*local-tools-image')
    expect(admissionRole).toContain('dist-local-tools/provision-ai-admission-role.js')
    expect(googleAdmissionRole).toContain('*local-tools-image')
    expect(googleAdmissionRole).toContain(
      'dist-local-tools/provision-google-admission-role.js',
    )
    expect(seed).toContain('LOCAL_TOOL_EXECUTION_IDENTITY: repkey-local-stack-v1')
    expect(admissionRole).toContain(
      'LOCAL_TOOL_EXECUTION_IDENTITY: repkey-local-stack-v1',
    )
  })

  it('fails closed unless the local stack supplies its exact execution identity', () => {
    expect(() => assertLocalToolExecutionIdentity({})).toThrow(
      /local-stack execution identity/u,
    )
    expect(() =>
      assertLocalToolExecutionIdentity({
        LOCAL_TOOL_EXECUTION_IDENTITY: 'production',
      }),
    ).toThrow(/local-stack execution identity/u)
    expect(() =>
      assertLocalToolExecutionIdentity({
        LOCAL_TOOL_EXECUTION_IDENTITY: 'repkey-local-stack-v1',
      }),
    ).not.toThrow()
  })

  it('accepts a serving artifact without local-tool content', () => {
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
      'forbidden source-map import',
      'index.js.map',
      JSON.stringify({
        sources: ['../scripts/local-stack/provision-ai-admission-role.ts'],
      }),
    ],
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
