import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AI_EGRESS_PROBE_DEPLOYMENT_CONTRACT_V1,
  AI_EGRESS_PROBE_START_COMMAND,
  parseAiEgressProbeCleanupReceiptV1,
  parseAiEgressProbeDeploymentPlanV1,
} from './ai-egress-probe-deployment-contract'

const ROOT = process.cwd()
const RELEASE_SHA = 'a'.repeat(40)
const IMAGE_DIGEST = `sha256:${'b'.repeat(64)}`

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8')
}

function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(from), specifier)
  const candidates =
    extname(base) === ''
      ? [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]
      : [base]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function localModuleGraph(entry: string): ReadonlySet<string> {
  const pending = [resolve(ROOT, entry)]
  const seen = new Set<string>()
  const importPattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gu
  while (pending.length > 0) {
    const current = pending.pop()!
    if (seen.has(current)) continue
    seen.add(current)
    const text = readFileSync(current, 'utf8')
    for (const match of text.matchAll(importPattern)) {
      const target = resolveImport(current, match[1]!)
      if (target !== null) pending.push(target)
    }
  }
  return seen
}

describe('AI egress probe deployment contract', () => {
  it('requires the exact candidate gateway image digest', () => {
    expect(
      parseAiEgressProbeDeploymentPlanV1({
        version: 'ai-egress-probe-deployment-v1',
        releaseSha: RELEASE_SHA,
        gatewayImageDigest: IMAGE_DIGEST,
        probeImageDigest: IMAGE_DIGEST,
        region: 'us-west2',
        startCommand: AI_EGRESS_PROBE_START_COMMAND,
      }),
    ).toMatchObject({ probeImageDigest: IMAGE_DIGEST })

    expect(() =>
      parseAiEgressProbeDeploymentPlanV1({
        version: 'ai-egress-probe-deployment-v1',
        releaseSha: RELEASE_SHA,
        gatewayImageDigest: IMAGE_DIGEST,
        probeImageDigest: `sha256:${'c'.repeat(64)}`,
        region: 'us-west2',
        startCommand: AI_EGRESS_PROBE_START_COMMAND,
      }),
    ).toThrow(/invalid/)
  })

  it('requires zero active service, deployment, domain, variable, credential, or build residue', () => {
    const createdResourceIds = {
      service: ['service:1'],
      deployment: ['deployment:1'],
      domain: [],
      variable: ['variable:1'],
      credential: [],
      build: ['build:1'],
    }
    expect(
      parseAiEgressProbeCleanupReceiptV1({
        version: 'ai-egress-probe-cleanup-v1',
        releaseSha: RELEASE_SHA,
        gatewayImageDigest: IMAGE_DIGEST,
        region: 'us-west2',
        createdResourceIds,
        residualActiveResourceIds: [],
      }),
    ).toMatchObject({ createdResourceIds })
    expect(() =>
      parseAiEgressProbeCleanupReceiptV1({
        version: 'ai-egress-probe-cleanup-v1',
        releaseSha: RELEASE_SHA,
        gatewayImageDigest: IMAGE_DIGEST,
        region: 'us-west2',
        createdResourceIds,
        residualActiveResourceIds: ['service:1'],
      }),
    ).toThrow(/invalid/)
  })

  it('returns a detached deeply frozen cleanup receipt', () => {
    const createdResourceIds = {
      service: ['service:1'],
      deployment: ['deployment:1'],
      domain: [],
      variable: ['variable:1'],
      credential: [],
      build: ['build:1'],
    }
    const parsed = parseAiEgressProbeCleanupReceiptV1({
      version: 'ai-egress-probe-cleanup-v1',
      releaseSha: RELEASE_SHA,
      gatewayImageDigest: IMAGE_DIGEST,
      region: 'us-west2',
      createdResourceIds,
      residualActiveResourceIds: [],
    })

    expect(parsed.createdResourceIds).not.toBe(createdResourceIds)
    expect(parsed.createdResourceIds.service).not.toBe(createdResourceIds.service)
    createdResourceIds.service[0] = 'service:changed'
    expect(parsed.createdResourceIds.service).toEqual(['service:1'])
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.createdResourceIds)).toBe(true)
    expect(
      AI_EGRESS_PROBE_DEPLOYMENT_CONTRACT_V1.residueKinds.every((kind) =>
        Object.isFrozen(parsed.createdResourceIds[kind]),
      ),
    ).toBe(true)
    expect(Object.isFrozen(parsed.residualActiveResourceIds)).toBe(true)
    expect(() =>
      (parsed.createdResourceIds.service as string[]).push('service:2'),
    ).toThrow(TypeError)
    expect(() =>
      (parsed.residualActiveResourceIds as string[]).push('service:2'),
    ).toThrow(TypeError)
  })

  it('bundles a build-isolated probe in the production gateway image', () => {
    const dockerfile = source('Dockerfile.ai-egress-gateway')
    const gatewayBuild = source('tsup.ai-egress-gateway.config.ts')
    const probeBuild = source('tsup.ai-egress-probe.config.ts')
    const productionRailway = JSON.parse(
      source('railway.ai-egress-gateway.json'),
    ) as Record<string, unknown>
    const probeRailway = JSON.parse(source('railway.ai-egress-probe.json')) as Record<
      string,
      unknown
    >

    expect(existsSync(resolve(ROOT, 'Dockerfile.ai-egress-probe'))).toBe(false)
    expect(dockerfile).toContain('tsup.ai-egress-probe.config.ts')
    expect(dockerfile).toContain(
      'COPY --from=build /app/dist-ai-egress-probe ./dist-ai-egress-probe',
    )
    expect(gatewayBuild).not.toContain('runtime-egress-probe')
    expect(probeBuild).toContain(
      "'runtime-egress-probe': 'services/ai-egress-gateway/runtime-egress-probe.ts'",
    )
    expect(productionRailway).toMatchObject({
      build: { dockerfilePath: 'Dockerfile.ai-egress-gateway' },
      deploy: { startCommand: 'node dist-ai-egress-gateway/index.js' },
    })
    expect(probeRailway).toEqual({
      $schema: 'https://railway.com/railway.schema.json',
      deploy: {
        numReplicas: 1,
        restartPolicyType: 'NEVER',
        startCommand: AI_EGRESS_PROBE_START_COMMAND,
      },
    })
  })

  it('keeps the probe outside the production gateway module graph', () => {
    expect(existsSync(resolve(ROOT, 'services/ai-egress-gateway/index.ts'))).toBe(true)
    const graph = localModuleGraph('services/ai-egress-gateway/index.ts')
    expect([...graph].some((path) => path.endsWith('runtime-egress-probe.ts'))).toBe(
      false,
    )
  })
})
