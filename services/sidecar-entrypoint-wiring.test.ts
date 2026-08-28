import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(path, 'utf8')

const RUNTIMES = [
  'services/google-execution-admission/index.ts',
  'services/google-egress-gateway/index.ts',
  'services/ai-execution-admission/index.ts',
  'services/ai-egress-gateway/bootstrap.ts',
] as const

describe('sidecar executable operational wiring', () => {
  it('preloads monitoring before each protected runtime module', () => {
    for (const [entry, runtime] of [
      ['services/google-execution-admission/entry.ts', "import('./index')"],
      ['services/google-egress-gateway/entry.ts', "import('./index')"],
      ['services/ai-execution-admission/entry.ts', "import('./index')"],
    ] as const) {
      const contents = source(entry)
      expect(contents).toContain('runSidecarStartup(')
      expect(contents).toContain(runtime)
    }

    const aiGateway = source('services/ai-egress-gateway/index.ts')
    expect(aiGateway).toContain('runSidecarStartup(')
    expect(aiGateway).toContain("import('./bootstrap')")
    expect(aiGateway).toContain("import('./openai-connector')")

    expect(source('tsup.google-execution-admission.config.ts')).toContain(
      "index: 'services/google-execution-admission/entry.ts'",
    )
    expect(source('tsup.google-egress-gateway.config.ts')).toContain(
      "index: 'services/google-egress-gateway/entry.ts'",
    )
    expect(source('tsup.ai-execution-admission.config.ts')).toContain(
      "index: 'services/ai-execution-admission/entry.ts'",
    )
  })

  it('gives all four runtimes dynamic readiness and one lifecycle owner', () => {
    for (const path of RUNTIMES) {
      const contents = source(path)
      expect(contents, path).toContain('createSidecarPlatformHealthServer({')
      expect(contents, path).toContain('registerSidecarOperationalLifecycle({')
      expect(contents, path).toContain('resolveSidecarRuntimePorts(process.env)')
      expect(contents, path).not.toContain("process.once('SIGTERM'")
      expect(contents, path).not.toContain("process.once('SIGINT'")
    }
  })

  it('uses real bounded post-boot dependency probes', () => {
    const googleAdmission = source(RUNTIMES[0])
    expect(googleAdmission).toContain('redis.ping()')
    expect(googleAdmission).toContain('authority.readiness()')

    const googleGateway = source(RUNTIMES[1])
    expect(googleGateway).toContain("admissionTransport.get('/health/ready', { signal })")

    const aiAdmission = source(RUNTIMES[2])
    expect(aiAdmission).toContain('service.readiness()')

    const aiGateway = source(RUNTIMES[3])
    expect(aiGateway).toContain('service.readiness(signal)')
  })

  it('keeps temporary Railway configs and runtime images on the same port contract', () => {
    for (const stem of [
      'google-execution-admission',
      'google-egress-gateway',
      'ai-execution-admission',
      'ai-egress-gateway',
    ]) {
      const config = JSON.parse(source(`railway.${stem}.json`)) as {
        deploy?: Record<string, unknown>
      }
      expect(config.deploy, stem).toMatchObject({
        healthcheckPath: '/health/ready',
        healthcheckTimeout: 30,
      })
      expect(source(`Dockerfile.${stem}`), stem).toContain('EXPOSE 8080 8443')
    }
  })
})
