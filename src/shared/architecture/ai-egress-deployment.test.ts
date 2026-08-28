import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AI_GATEWAY_BUILD_ATTESTATION_V1 } from '../ai-gateway-build-attestation'

const ROOT = process.cwd()
const compose = readFileSync(join(ROOT, 'compose.local.yml'), 'utf8')
const dockerfile = readFileSync(join(ROOT, 'Dockerfile.ai-egress-gateway'), 'utf8')
const admissionDockerfile = readFileSync(
  join(ROOT, 'Dockerfile.ai-execution-admission'),
  'utf8',
)
const admissionRailway = JSON.parse(
  readFileSync(join(ROOT, 'railway.ai-execution-admission.json'), 'utf8'),
) as {
  deploy: { numReplicas: number }
}
const railway = JSON.parse(
  readFileSync(join(ROOT, 'railway.ai-egress-gateway.json'), 'utf8'),
) as {
  build: { dockerfilePath: string }
  deploy: {
    numReplicas: number
    startCommand: string
    restartPolicyType: string
  }
}
const canaryRailway = JSON.parse(
  readFileSync(join(ROOT, 'railway.ai-egress-canary.json'), 'utf8'),
) as {
  build: { dockerfilePath: string }
  deploy: {
    numReplicas: number
    startCommand: string
    restartPolicyType: string
  }
}

function serviceBlock(name: string): string {
  const marker = `  ${name}:\n`
  const start = compose.indexOf(marker)
  if (start < 0) throw new Error(`missing Compose service ${name}`)
  const tail = compose.slice(start + marker.length)
  const nextService = /\n {2}[a-z0-9][a-z0-9-]*:\n/u.exec(tail)
  return compose.slice(
    start,
    nextService === null ? compose.length : start + marker.length + nextService.index,
  )
}

describe('PR5 AI egress deployment isolation', () => {
  it('ships one non-root image with governed production, canary, and probe entries', () => {
    expect(dockerfile).toContain('USER node')
    expect(dockerfile).toContain('CMD ["node", "dist-ai-egress-gateway/index.js"]')
    expect(dockerfile).not.toMatch(/ENTRYPOINT|OPENAI_BASE_URL/u)
    expect(dockerfile).not.toMatch(/COPY --from=.*node_modules|COPY package\.runtime/u)
    expect(dockerfile).not.toMatch(/IMAGE_SOURCE_REVISION|AI_GATEWAY_NODE_VERSION/u)
    expect(dockerfile).toContain('scripts/verify-ai-egress-gateway-bundle.mjs')
    expect(AI_GATEWAY_BUILD_ATTESTATION_V1.production.command).toEqual([
      'node',
      'dist-ai-egress-gateway/index.js',
    ])
    expect(AI_GATEWAY_BUILD_ATTESTATION_V1.syntheticCanary.commandOverride).toEqual([
      'node',
      'dist-ai-egress-gateway/canary.js',
    ])
    expect(AI_GATEWAY_BUILD_ATTESTATION_V1.runtimeEgressProbe.commandOverride).toEqual([
      'node',
      'dist-ai-egress-probe/runtime-egress-probe.js',
    ])
  })

  it('keeps the local provider stub on a build-isolated compile-time transport', () => {
    const gateway = serviceBlock('ai-egress-gateway')
    const provider = serviceBlock('ai-provider-stub')
    expect(gateway).toContain('target: local-provider')
    expect(gateway).toContain(
      'command: [node, dist-ai-egress-gateway-local/local-provider-entry.js]',
    )
    expect(dockerfile).toContain('FROM runtime AS local-provider')
    expect(dockerfile).toContain(
      'CMD ["node", "dist-ai-egress-gateway-local/local-provider-entry.js"]',
    )
    expect(dockerfile.trimEnd()).toMatch(/FROM runtime AS production$/u)
    expect(provider).not.toMatch(
      /BQC_STUB_TLS_|provider-ca|ai-provider-stub\.(?:crt|key)/u,
    )
    expect(gateway).not.toMatch(/OPENAI_BASE_URL|AI_PROVIDER_STUB/u)
    expect(railway.deploy.startCommand).toBe('node dist-ai-egress-gateway/index.js')
  })

  it('governs the one-shot canary as the same image with a non-restarting command override', () => {
    expect(canaryRailway).toEqual({
      $schema: 'https://railway.com/railway.schema.json',
      build: {
        builder: 'DOCKERFILE',
        dockerfilePath: 'Dockerfile.ai-egress-gateway',
      },
      deploy: {
        numReplicas: 1,
        restartPolicyType: 'NEVER',
        restartPolicyMaxRetries: 0,
        startCommand: 'node dist-ai-egress-gateway/canary.js',
      },
    })
  })

  it('ships admission as a non-root bundled database-only runtime', () => {
    expect(admissionDockerfile).toContain('USER node')
    expect(admissionDockerfile).toContain(
      'CMD ["node", "dist-ai-execution-admission/index.js"]',
    )
    expect(admissionDockerfile).toContain(
      'scripts/verify-ai-execution-admission-bundle.mjs',
    )
    expect(admissionDockerfile).not.toMatch(
      /COPY --from=.*node_modules|COPY package\.runtime|IMAGE_SOURCE_REVISION/u,
    )
    expect(admissionRailway.deploy.numReplicas).toBe(1)
  })

  it('starts killed at one replica and binds the post-drill scale target to two', () => {
    expect(railway).toEqual(
      expect.objectContaining({
        build: expect.objectContaining({
          dockerfilePath: 'Dockerfile.ai-egress-gateway',
        }),
        deploy: expect.objectContaining({
          numReplicas: 1,
          startCommand: 'node dist-ai-egress-gateway/index.js',
          restartPolicyType: 'ON_FAILURE',
        }),
      }),
    )
    expect(railway.deploy).toMatchObject({
      healthcheckPath: '/health/ready',
      healthcheckTimeout: 30,
    })
    expect(AI_GATEWAY_BUILD_ATTESTATION_V1.image).toMatchObject({
      initialReplicas: 1,
      postDrillReplicas: 2,
    })
    expect(JSON.stringify(railway)).not.toMatch(/canary|probe|stub|OPENAI_BASE_URL/u)
  })

  it('keeps caller, admission, provider, and gateway networks directionally disjoint', () => {
    const web = serviceBlock('web')
    const worker = serviceBlock('worker')
    const gateway = serviceBlock('ai-egress-gateway')
    const admission = serviceBlock('ai-execution-admission')
    const provider = serviceBlock('ai-provider-stub')

    for (const caller of [web, worker]) {
      expect(caller).toContain('ai-gateway-ingress')
      expect(caller).not.toContain('ai-admission-control')
      expect(caller).not.toContain('ai-provider-egress')
      expect(caller).not.toContain('OPENAI_API_KEY')
    }
    expect(gateway).toContain('ai-gateway-ingress')
    expect(gateway).toContain('ai-admission-control')
    expect(gateway).toContain('ai-provider-egress')
    expect(gateway).not.toContain('OPENAI_BASE_URL')
    expect(admission).toContain('ai-admission-control')
    expect(admission).not.toContain('ai-provider-egress')
    expect(provider).toContain('ai-provider-egress')
    expect(provider).not.toContain('ai-gateway-ingress')
    expect(provider).not.toContain('ai-admission-control')
  })

  it('declares every AI trust network internal and never exposes the production gateway', () => {
    for (const network of [
      'ai-gateway-ingress',
      'ai-admission-control',
      'ai-provider-egress',
    ]) {
      expect(compose).toContain(`  ${network}:\n    internal: true`)
    }
    expect(serviceBlock('ai-egress-gateway')).not.toContain('ports:')
  })
})
