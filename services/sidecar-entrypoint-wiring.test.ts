import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(path, 'utf8')

const RUNTIMES = [
  'services/google-execution-admission/index.ts',
  'services/google-egress-gateway/index.ts',
  'services/ai-execution-admission/index.ts',
  'services/ai-egress-gateway/bootstrap.ts',
] as const

/**
 * ARC-03-T2: the only `src/shared/` surface a separately deployed sidecar may
 * link. A trailing `-` or `/` marks a family; every other entry is an exact
 * module. Mirrored by the `shared-provider-kernel` file category in
 * eslint.config.js and by "Trust-boundary sidecar kernel" in
 * src/shared/CONTEXT.md — all three are asserted equal below, because a fence
 * that only exists in one of the three is a fence someone deletes by accident.
 */
const SIDECAR_SHARED_KERNEL = [
  'src/shared/ai-',
  'src/shared/canonical-json',
  'src/shared/closed-json-contract',
  'src/shared/config/release-identity',
  'src/shared/ed25519-key-material',
  'src/shared/google-provider-control/',
  'src/shared/merchant-ai-',
  'src/shared/observability/telemetry',
  'src/shared/openai-',
  'src/shared/provider-ephemeral/runtime-verification',
  'src/shared/security/versioned-hmac-keyring',
] as const

function sidecarModules(directory = 'services'): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sidecarModules(path)
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return []
    return [path]
  })
}

/** Every `src/shared/...` specifier in a module, normalized to a repo path. */
function sharedSpecifiers(contents: string): readonly string[] {
  return [...contents.matchAll(/from\s+'([^']+)'|import\('([^']+)'\)/gu)]
    .map((match) => match[1] ?? match[2]!)
    .filter((specifier) => specifier.includes('src/shared/'))
    .map((specifier) => specifier.slice(specifier.indexOf('src/shared/')))
}

function outsideKernel(contents: string): readonly string[] {
  return sharedSpecifiers(contents).filter(
    (specifier) =>
      !SIDECAR_SHARED_KERNEL.some((entry) =>
        entry.endsWith('-') || entry.endsWith('/')
          ? specifier.startsWith(entry)
          : specifier === entry,
      ),
  )
}

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

  it('never links a monitoring SDK into an AI sidecar, and always into a Google one', () => {
    // `scripts/verify-ai-runtime-image.mjs` refuses an AI image whose bundle
    // contains `node_modules/@sentry/`. That gate only fires after a docker
    // build, so this walks the same static graph the bundler does and fails in
    // seconds instead: the AI pair IS the egress boundary, and an SDK opening
    // its own outbound connection from inside it is a hole in the decision.
    const reachable = (entry: string): ReadonlySet<string> => {
      const seen = new Set<string>()
      const queue = [entry]
      while (queue.length > 0) {
        const current = queue.pop()!
        if (seen.has(current)) continue
        seen.add(current)
        // `import type` is erased by the bundler, so it is not a link. The
        // declaration may span lines, so it is matched up to its own specifier.
        const value = source(current).replaceAll(
          /\bimport\s+type\s[\s\S]*?from\s+'[^']+'/gu,
          '',
        )
        for (const match of value.matchAll(
          /from\s+'(\.[^']+)'|import\('(\.[^']+)'\)/gu,
        )) {
          const specifier = match[1] ?? match[2]!
          const base = resolve(dirname(current), specifier)
          const target = ['.ts', '/index.ts'].map((suffix) => `${base}${suffix}`)
          const resolved = target.find((candidate) => existsSync(candidate))
          if (resolved) queue.push(relative(process.cwd(), resolved))
        }
      }
      return seen
    }

    const TELEMETRY = 'src/shared/observability/telemetry.ts'
    for (const entry of [
      'services/ai-execution-admission/entry.ts',
      'services/ai-egress-gateway/index.ts',
      'services/ai-egress-gateway/local-provider-entry.ts',
      'services/ai-egress-gateway/runtime-egress-probe.ts',
    ]) {
      expect([...reachable(entry)], entry).not.toContain(TELEMETRY)
    }

    // The same walk proves the Google pair still HAS one: a fix that silenced
    // both halves would otherwise pass.
    for (const entry of [
      'services/google-execution-admission/entry.ts',
      'services/google-egress-gateway/entry.ts',
    ]) {
      expect([...reachable(entry)], entry).toContain(TELEMETRY)
    }
  })

  it('links only the named shared provider kernel, never the application runtime', () => {
    const escapes = sidecarModules()
      .map((path) => ({ path, outside: outsideKernel(source(path)) }))
      .filter(({ outside }) => outside.length > 0)
    expect(escapes).toEqual([])

    // The walk has to actually see something, or an empty glob would pass.
    const linked = new Set(
      sidecarModules().flatMap((path) => sharedSpecifiers(source(path))),
    )
    expect(linked.size).toBeGreaterThan(10)
  })

  it('fails when a sidecar module reaches the application database', () => {
    // The control the assertion above is worthless without: an injected module
    // that opens the application database must be reported, not tolerated.
    const injected = [
      "import { getDb } from '../../src/shared/db'",
      "import { INTERNAL_TRANSPORT } from '../../src/shared/ai-internal-transport-contract'",
    ].join('\n')
    expect(outsideKernel(injected)).toEqual(['src/shared/db'])
  })

  it('keeps the kernel identical in the linter, the documentation and this test', () => {
    const eslintConfig = source('eslint.config.js')
    const category = eslintConfig.slice(
      eslintConfig.indexOf("category: 'shared-provider-kernel'"),
    )
    const patterns = category
      .slice(0, category.indexOf('],'))
      .split('\n')
      .map((line) => /'([^']+)'/u.exec(line.trim())?.[1])
      .filter((pattern): pattern is string => Boolean(pattern?.startsWith('src/shared/')))
    expect([...patterns].sort()).toEqual(
      SIDECAR_SHARED_KERNEL.map((entry) =>
        entry.endsWith('/')
          ? `${entry}**`
          : entry.endsWith('-')
            ? `${entry}*`
            : `${entry}.ts`,
      )
        .slice()
        .sort(),
    )

    const context = source('src/shared/CONTEXT.md')
    const documented = context
      .slice(
        context.indexOf('<!-- sidecar-shared-kernel:start -->'),
        context.indexOf('<!-- sidecar-shared-kernel:end -->'),
      )
      .split('\n')
      .map((line) => /`(src\/shared\/[^`]+)`/u.exec(line)?.[1])
      .filter((entry): entry is string => Boolean(entry))
    expect([...documented].sort()).toEqual([...SIDECAR_SHARED_KERNEL].sort())
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
