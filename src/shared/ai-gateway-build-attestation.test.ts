import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AI_GATEWAY_BUILD_ATTESTATION_DIGEST,
  AI_GATEWAY_BUILD_ATTESTATION_V1,
} from './ai-gateway-build-attestation'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'

const ROOT = process.cwd()

function filesUnder(path: string): string[] {
  const absolute = join(ROOT, path)
  if (!existsSync(absolute)) return []
  const result: string[] = []
  for (const entry of readdirSync(absolute)) {
    const candidate = join(absolute, entry)
    if (statSync(candidate).isDirectory())
      result.push(...filesUnder(relative(ROOT, candidate)))
    else if (/\.(?:ts|tsx)$/u.test(entry) && !/\.test\.(?:ts|tsx)$/u.test(entry))
      result.push(candidate)
  }
  return result
}

const importPattern = /(?:from|import\()\s*['"]([^'"]+)['"]/gu

function normalized(path: string): string {
  return path.split('\\').join('/')
}
function resolveLocalImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(importer), specifier)
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  throw new Error(`Unresolved local import ${specifier} from ${relative(ROOT, importer)}`)
}

function localImportClosure(entry: string): ReadonlySet<string> {
  const pending = [join(ROOT, entry)]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || visited.has(file)) continue
    visited.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(importPattern)) {
      const resolved = resolveLocalImport(file, match[1] ?? '')
      if (resolved && !visited.has(resolved)) pending.push(resolved)
    }
  }
  return new Set([...visited].map((file) => normalized(relative(ROOT, file))))
}

describe('AI gateway build attestation', () => {
  it('has a stable domain-separated digest and every registered artifact exists', () => {
    expect(AI_GATEWAY_BUILD_ATTESTATION_DIGEST).toBe(
      createHash('sha256')
        .update('repkey-ai-egress-gateway-build-v1\0', 'utf8')
        .update(canonicalizeRfc8785(AI_GATEWAY_BUILD_ATTESTATION_V1), 'utf8')
        .digest('hex'),
    )
    const paths = [
      AI_GATEWAY_BUILD_ATTESTATION_V1.production.sourceEntry,
      AI_GATEWAY_BUILD_ATTESTATION_V1.image.dockerfile,
      AI_GATEWAY_BUILD_ATTESTATION_V1.image.buildConfig,
      AI_GATEWAY_BUILD_ATTESTATION_V1.image.runtimeAssetBuildConfig,
      AI_GATEWAY_BUILD_ATTESTATION_V1.image.runtimeAssetVerifier,
      AI_GATEWAY_BUILD_ATTESTATION_V1.image.bundleInventoryVerifier,
      AI_GATEWAY_BUILD_ATTESTATION_V1.syntheticCanary.sourceEntry,
      AI_GATEWAY_BUILD_ATTESTATION_V1.runtimeEgressProbe.sourceEntry,
      AI_GATEWAY_BUILD_ATTESTATION_V1.runtimeEgressProbe.buildConfig,
      AI_GATEWAY_BUILD_ATTESTATION_V1.providerStub.sourceEntry,
      AI_GATEWAY_BUILD_ATTESTATION_V1.localProviderStubTransport.sourceEntry,
      AI_GATEWAY_BUILD_ATTESTATION_V1.localProviderStubTransport.transportSource,
      AI_GATEWAY_BUILD_ATTESTATION_V1.localProviderStubTransport.buildConfig,
      ...AI_GATEWAY_BUILD_ATTESTATION_V1.serverOnlyArtifacts,
    ]
    expect(paths.filter((path) => !existsSync(join(ROOT, path)))).toEqual([])
  })

  it('keeps OpenAI imports exclusively in the production gateway source root', () => {
    const files = [...filesUnder('src'), ...filesUnder('services')]
    const importers = files
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        return [...source.matchAll(importPattern)].some(
          (match) => match[1] === 'openai' || match[1]?.startsWith('openai/'),
        )
      })
      .map((file) => normalized(relative(ROOT, file)))
    expect(
      importers.filter(
        (path) =>
          !path.startsWith(AI_GATEWAY_BUILD_ATTESTATION_V1.sdk.soleProductionImportRoot),
      ),
    ).toEqual([])
  })

  it('keeps server-only classifier, detector, and catalogue assets out of browser roots', () => {
    const forbiddenBasenames = new Set(
      AI_GATEWAY_BUILD_ATTESTATION_V1.serverOnlyArtifacts.map((path) =>
        path.slice(path.lastIndexOf('/') + 1).replace(/\.ts$/u, ''),
      ),
    )
    const offenders = AI_GATEWAY_BUILD_ATTESTATION_V1.browserRoots
      .flatMap(filesUnder)
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8')
        return [...source.matchAll(importPattern)]
          .map((match) => match[1] ?? '')
          .filter((specifier) =>
            [...forbiddenBasenames].some((name) => specifier.includes(name)),
          )
          .map((specifier) => `${normalized(relative(ROOT, file))} -> ${specifier}`)
      })
    expect(offenders).toEqual([])
  })

  it('builds isolated production, canary, and probe entries into one immutable image', () => {
    const buildConfig = readFileSync(
      join(ROOT, AI_GATEWAY_BUILD_ATTESTATION_V1.image.buildConfig),
      'utf8',
    )
    const probeBuildConfig = readFileSync(
      join(ROOT, AI_GATEWAY_BUILD_ATTESTATION_V1.runtimeEgressProbe.buildConfig),
      'utf8',
    )
    const dockerfile = readFileSync(
      join(ROOT, AI_GATEWAY_BUILD_ATTESTATION_V1.image.dockerfile),
      'utf8',
    )
    for (const entry of [
      AI_GATEWAY_BUILD_ATTESTATION_V1.production,
      AI_GATEWAY_BUILD_ATTESTATION_V1.syntheticCanary,
    ]) {
      expect(buildConfig).toContain(entry.sourceEntry)
      expect(dirname(entry.bundleEntry)).toBe(
        AI_GATEWAY_BUILD_ATTESTATION_V1.image.bundleDirectory,
      )
    }
    expect(buildConfig).not.toContain(
      AI_GATEWAY_BUILD_ATTESTATION_V1.runtimeEgressProbe.sourceEntry,
    )
    expect(probeBuildConfig).toContain(
      AI_GATEWAY_BUILD_ATTESTATION_V1.runtimeEgressProbe.sourceEntry,
    )
    expect(dirname(AI_GATEWAY_BUILD_ATTESTATION_V1.runtimeEgressProbe.bundleEntry)).toBe(
      AI_GATEWAY_BUILD_ATTESTATION_V1.runtimeEgressProbe.bundleDirectory,
    )
    expect(buildConfig).toContain('splitting: false')
    expect(probeBuildConfig).toContain('splitting: false')
    for (const directory of [
      AI_GATEWAY_BUILD_ATTESTATION_V1.image.bundleDirectory,
      AI_GATEWAY_BUILD_ATTESTATION_V1.runtimeEgressProbe.bundleDirectory,
    ]) {
      expect(dockerfile).toContain(
        `COPY --from=build /app/${directory} ` + `./${directory}`,
      )
    }
    expect(AI_GATEWAY_BUILD_ATTESTATION_V1.image.oneImmutableImageDigest).toBe(true)
  })

  it('keeps canary, probe, and local provider transport outside production imports', () => {
    const production = localImportClosure(
      AI_GATEWAY_BUILD_ATTESTATION_V1.production.sourceEntry,
    )
    const canary = localImportClosure(
      AI_GATEWAY_BUILD_ATTESTATION_V1.syntheticCanary.sourceEntry,
    )
    const probe = localImportClosure(
      AI_GATEWAY_BUILD_ATTESTATION_V1.runtimeEgressProbe.sourceEntry,
    )
    const localProvider = localImportClosure(
      AI_GATEWAY_BUILD_ATTESTATION_V1.localProviderStubTransport.sourceEntry,
    )
    expect(
      production.has(AI_GATEWAY_BUILD_ATTESTATION_V1.syntheticCanary.sourceEntry),
    ).toBe(false)
    expect(
      production.has(AI_GATEWAY_BUILD_ATTESTATION_V1.runtimeEgressProbe.sourceEntry),
    ).toBe(false)
    expect(production.has(AI_GATEWAY_BUILD_ATTESTATION_V1.providerStub.sourceEntry)).toBe(
      false,
    )
    expect(
      production.has(
        AI_GATEWAY_BUILD_ATTESTATION_V1.localProviderStubTransport.sourceEntry,
      ),
    ).toBe(false)
    expect(
      production.has(
        AI_GATEWAY_BUILD_ATTESTATION_V1.localProviderStubTransport.transportSource,
      ),
    ).toBe(false)
    expect(canary.has(AI_GATEWAY_BUILD_ATTESTATION_V1.production.sourceEntry)).toBe(false)
    expect(
      canary.has(AI_GATEWAY_BUILD_ATTESTATION_V1.runtimeEgressProbe.sourceEntry),
    ).toBe(false)
    expect(probe.has(AI_GATEWAY_BUILD_ATTESTATION_V1.production.sourceEntry)).toBe(false)
    expect(probe.has(AI_GATEWAY_BUILD_ATTESTATION_V1.syntheticCanary.sourceEntry)).toBe(
      false,
    )
    expect(
      localProvider.has(AI_GATEWAY_BUILD_ATTESTATION_V1.production.sourceEntry),
    ).toBe(false)
    expect(AI_GATEWAY_BUILD_ATTESTATION_V1.providerStub.productionSelectable).toBe(false)
    expect(AI_GATEWAY_BUILD_ATTESTATION_V1.localProviderStubTransport).toMatchObject({
      dockerTarget: 'local-provider',
      productionSelectable: false,
      productionImportForbidden: true,
    })
  })
})
