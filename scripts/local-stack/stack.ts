import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { basename, extname, resolve } from 'node:path'
import { connect } from 'node:net'
import { createPrivateKey, createPublicKey, randomBytes } from 'node:crypto'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '../../src/shared/ai-operation-profiles'
import { AI_RUNTIME_CAPABILITIES_V1_DIGEST } from '../../src/shared/ai-runtime-capability-contract'
import { selectProbeEvidence } from '#/shared/testing/probe-evidence'
import {
  readLocalStackFile,
  readOptionalLocalStackFile,
} from '../../src/shared/testing/local-stack-artifact-file'
import {
  buildLocalStackEnv,
  createMigrationHeadProof,
  expectedMigrationHead,
  localStackProject,
  parseLocalStackMode,
  sha256,
  type LocalStackMode,
  type MigrationHeadProof,
} from '../../src/shared/testing/local-stack-controller'
import { assertPinnedRuntime } from '../../src/shared/testing/pinned-runtime'
import {
  localStackPlaywrightEnv,
  parseLocalStackEnvFile as parseEnvFile,
} from '../../src/shared/testing/local-stack-playwright-env'

const ROOT = process.cwd()
const COMPOSE_FILE = resolve(ROOT, 'compose.local.yml')
const JOURNAL_FILE = resolve(ROOT, 'drizzle/meta/_journal.json')
const MIGRATION_DIR = resolve(ROOT, 'drizzle')
const WORKER_READY_LINE = 'BullMQ worker started on default queue'
const APP_SERVICES = [
  'provider-sandbox',
  'ai-provider-stub',
  'mail-stub',
  'migrator',
  'seed',
  'web',
  'web-locked',
  'worker',
  'perf-runner',
] as const

const FAULTS = [
  { name: 'db', service: 'postgres', endpoint: 'tcp', port: 55434 },
  { name: 'cache-redis', service: 'redis', endpoint: 'operation' },
  { name: 'redis', service: 'queue-redis', endpoint: 'operation' },
  {
    name: 'object-store',
    service: 'object-store',
    endpoint: 'http',
    url: 'http://127.0.0.1:4900/minio/health/live',
  },
  {
    name: 'gbp',
    service: 'provider-sandbox',
    endpoint: 'http',
    url: 'http://127.0.0.1:4100/__control/health',
  },
  {
    name: 'mail',
    service: 'mail-stub',
    endpoint: 'http',
    url: 'http://127.0.0.1:4101/__control/health',
  },
  {
    name: 'web',
    service: 'web',
    endpoint: 'http',
    url: 'http://127.0.0.1:3000/api/health/started',
  },
  { name: 'worker', service: 'worker', endpoint: 'container' },
] as const

type StackPaths = Readonly<{
  root: string
  env: string
  artifacts: string
  acceptance: string
  /** Bind-mounted at /artifacts/perf for the perf-runner (see prepare()). */
  perfArtifacts: string
  e2eArtifacts: string
  googleRuntime: string
  aiRuntime: string
  hostSeedState: string
}>

type DockerInspect = ReadonlyArray<{
  Image: string
  Config: { Image: string; User: string; Env: string[]; Labels: Record<string, string> }
  State: { Running: boolean }
  NetworkSettings: { Networks: Record<string, unknown> }
}>

type DockerImageInspect = ReadonlyArray<{
  Id: string
  RepoDigests: string[] | null
  Config: { Labels: Record<string, string> }
}>

type ObservedImageIdentities = Readonly<
  Record<
    'web' | 'worker' | 'provider' | 'perf',
    Readonly<{ imageId: string; repoDigests: readonly string[]; revisionLabel: string }>
  >
>
type WorkerContainerState = Readonly<{
  id: string
  startedAtMs: number
}>

type RunOptions = Readonly<{
  env?: NodeJS.ProcessEnv
  capture?: boolean
  allowFailure?: boolean
  includeStderr?: boolean
}>

type FaultObservation = Readonly<{
  fault: string
  service: string
  operationDuringFault: Readonly<{
    dependency: string
    phase: string
    observed: string
    error?: string
  }>
  operationAfterRecovery: Readonly<{
    dependency: string
    phase: string
    observed: string
  }>
  dependencyUnavailableObserved: boolean
  readinessDuringFault: Readonly<{ reachable: boolean; status: number | null }>
  failClosed: boolean
  recovered: boolean
  externalEffectsBefore: Readonly<{ gbpCalls: number; mailSends: number }>
  externalEffectsAfterFailedOperation: Readonly<{ gbpCalls: number; mailSends: number }>
  externalEffectsAfter: Readonly<{ gbpCalls: number; mailSends: number }>
  noDuplicateExternalEffect: boolean
  durableCountsBefore: Readonly<{ outbox: number; receipts: number }>
  durableCountsAfter: Readonly<{ outbox: number; receipts: number }>
  idempotentRestart: boolean
}>

function flagValue(flag: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`${flag}=`))
  return hit?.slice(flag.length + 1)
}

function paths(mode: LocalStackMode): StackPaths {
  const root = resolve(ROOT, '.local-stack', mode)
  const artifacts = resolve(ROOT, 'test-results', 'local-stack', mode)
  return {
    root,
    env: resolve(root, 'stack.env'),
    artifacts,
    acceptance: resolve(artifacts, 'acceptance'),
    perfArtifacts: resolve(artifacts, 'perf'),
    googleRuntime: resolve(root, 'e2e', 'google-runtime'),
    aiRuntime: resolve(root, 'e2e', 'ai-runtime'),
    e2eArtifacts: resolve(root, 'e2e'),
    hostSeedState: resolve(ROOT, 'e2e', '.seed-state.json'),
  }
}

function revision(): string {
  const value = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim()
  if (!/^[a-f0-9]{40,64}$/i.test(value)) {
    throw new Error('Could not resolve a concrete git SOURCE_REVISION')
  }
  return value
}

function serializeEnv(env: Readonly<Record<string, string>>): string {
  return `${Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n')}\n`
}

function prepareProviderRedisAssets(state: StackPaths, providerPassword: string): void {
  mkdirSync(state.googleRuntime, { recursive: true, mode: 0o700 })
  chmodSync(state.googleRuntime, 0o700)
  const asset = (name: string) => resolve(state.googleRuntime, name)
  const certificates = [
    {
      name: 'provider-redis',
      commonName: 'provider-redis',
      dnsName: 'provider-redis-ingress',
      usage: 'serverAuth',
    },
    {
      name: 'provider-sandbox',
      commonName: 'provider-sandbox',
      dnsName: 'provider-sandbox',
      usage: 'serverAuth',
    },
  ] as const
  const caCertificate = asset('ca.crt')
  const tlsProfile = asset('provider-tls-v1')
  const generatedAssets = certificates.flatMap(({ name }) => [
    `${name}.crt`,
    `${name}.key`,
  ])
  if (
    !existsSync(caCertificate) ||
    !existsSync(tlsProfile) ||
    generatedAssets.some((name) => !existsSync(asset(name)))
  ) {
    for (const name of [
      'ca.crt',
      'ca.key',
      'ca.srl',
      ...certificates.flatMap(({ name }) => [
        `${name}.crt`,
        `${name}.csr`,
        `${name}.key`,
        `${name}.ext`,
      ]),
    ]) {
      rmSync(asset(name), { force: true })
    }
    run(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        asset('ca.key'),
        '-out',
        caCertificate,
        '-subj',
        '/CN=repkey-local-provider-ca',
        '-days',
        '30',
      ],
      { capture: true },
    )
    for (const certificate of certificates) {
      run(
        'openssl',
        [
          'req',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          asset(`${certificate.name}.key`),
          '-out',
          asset(`${certificate.name}.csr`),
          '-subj',
          `/CN=${certificate.commonName}`,
        ],
        { capture: true },
      )
      const subjectAltNames = [
        ...('dnsName' in certificate ? [`DNS:${certificate.dnsName}`] : []),
        ...('uriName' in certificate ? [`URI:${certificate.uriName}`] : []),
      ]
      writeFileSync(
        asset(`${certificate.name}.ext`),
        `subjectAltName=${subjectAltNames.join(',')}\nextendedKeyUsage=${certificate.usage}\n`,
        { mode: 0o600 },
      )
      run(
        'openssl',
        [
          'x509',
          '-req',
          '-in',
          asset(`${certificate.name}.csr`),
          '-CA',
          caCertificate,
          '-CAkey',
          asset('ca.key'),
          '-CAcreateserial',
          '-out',
          asset(`${certificate.name}.crt`),
          '-days',
          '30',
          '-sha256',
          '-extfile',
          asset(`${certificate.name}.ext`),
        ],
        { capture: true },
      )
    }
    writeFileSync(tlsProfile, 'provider-tls-v1\n', { mode: 0o644 })
    for (const name of [
      'ca.key',
      'ca.srl',
      ...certificates.flatMap(({ name }) => [`${name}.csr`, `${name}.ext`]),
    ]) {
      rmSync(asset(name), { force: true })
    }
  }
  // The in-process provider runtime refuses a store with persistence,
  // replication, unbounded memory, or a default ACL identity.
  // The same endpoint also carries Google grants, quota buckets, and in-flight
  // leases, so its ACL must admit both namespaces and every Lua subcommand.
  const writeDedicatedRedis = (name: string, acl: string): void => {
    writeFileSync(asset(`${name}.acl`), acl, { mode: 0o600 })
    writeFileSync(
      asset(`${name}.conf`),
      [
        'bind 0.0.0.0',
        'protected-mode yes',
        'port 0',
        'tls-port 6379',
        `tls-cert-file /run/repkey/${name}.crt`,
        `tls-key-file /run/repkey/${name}.key`,
        'tls-ca-cert-file /run/repkey/ca.crt',
        'tls-auth-clients no',
        'save ""',
        'appendonly no',
        'maxmemory 67108864',
        'maxmemory-policy volatile-ttl',
        `aclfile /run/repkey/${name}.acl`,
        'dir /tmp',
        '',
      ].join('\n'),
      { mode: 0o600 },
    )
    chmodSync(asset(`${name}.acl`), 0o644)
    chmodSync(asset(`${name}.conf`), 0o644)
  }
  writeDedicatedRedis(
    'provider-redis',
    `user default off\nuser repkey on >${providerPassword} ~provider-ephemeral:* ~google-admission:* ~google-provider:* +ping +info +config|get +acl|whoami +acl|dryrun +get +set +getdel +del +hget +hset +pexpire +zadd +zcard +zrange +zrem +zremrangebyscore +eval\n`,
  )
  chmodSync(caCertificate, 0o644)
  chmodSync(tlsProfile, 0o644)
  for (const name of generatedAssets) chmodSync(asset(name), 0o644)
}

function prepareLocalAiRuntimeEnv(state: StackPaths): Readonly<Record<string, string>> {
  mkdirSync(state.aiRuntime, { recursive: true, mode: 0o700 })
  chmodSync(state.aiRuntime, 0o700)
  const admissionPrivateKeyPath = resolve(state.aiRuntime, 'ai-admission-ed25519.pk8')
  const provenancePrivateKeyPath = resolve(state.aiRuntime, 'ai-provenance-ed25519.pk8')
  const requestBindingKeyPath = resolve(state.aiRuntime, 'ai-request-binding-hmac.key')
  const safetyIdentifierKeyPath = resolve(
    state.aiRuntime,
    'ai-safety-identifier-hmac.key',
  )
  const subjectHmacKeyPath = resolve(state.aiRuntime, 'ai-subject-hmac.key')
  const writeFixedSigningKey = (path: string, label: string, seed: string): void => {
    const privateKey = Buffer.from(`302e020100300506032b657004220420${seed}`, 'hex')
    if (privateKey.byteLength !== 48) {
      throw new Error(`Local ${label} signing key fixture is invalid`)
    }
    const existing = readOptionalLocalStackFile(path)
    if (existing === null || !existing.equals(privateKey)) {
      writeFileSync(path, privateKey, { mode: 0o600 })
    }
    privateKey.fill(0)
    chmodSync(path, 0o600)
  }
  const createSymmetricKey = (path: string): void => {
    // One open answers both questions this used to ask the path separately —
    // "does it exist" and "what is in it". The freshly generated case needs no
    // read-back: `randomBytes(32)` is 32 bytes by construction, so the length
    // guard only ever has an already-present key to judge.
    const existing = readOptionalLocalStackFile(path)
    if (existing === null) {
      writeFileSync(path, randomBytes(32), { mode: 0o600 })
    } else if (existing.byteLength !== 32) {
      throw new Error('Local AI symmetric key is invalid')
    }
    chmodSync(path, 0o600)
  }
  writeFixedSigningKey(
    admissionPrivateKeyPath,
    'AI admission',
    '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
  )
  writeFixedSigningKey(
    provenancePrivateKeyPath,
    'AI provenance',
    '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
  )
  createSymmetricKey(requestBindingKeyPath)
  createSymmetricKey(safetyIdentifierKeyPath)
  createSymmetricKey(subjectHmacKeyPath)

  const privateKeyBase64 = (path: string): string =>
    readLocalStackFile(path).toString('base64')
  const publicKeyBase64 = (path: string): string =>
    createPublicKey(
      createPrivateKey({
        key: readLocalStackFile(path),
        format: 'der',
        type: 'pkcs8',
      }),
    )
      .export({ format: 'der', type: 'spki' })
      .toString('base64')
  const admissionKid = 'admission-v1'
  const provenanceKid = 'provenance-v1'
  return {
    AI_KEY_INVENTORY_PROFILE: 'local-stack-v1',
    AI_REQUEST_BINDING_HMAC_KEYS: `request-v1:${readLocalStackFile(requestBindingKeyPath).toString('hex')}`,
    AI_SAFETY_IDENTIFIER_HMAC_KEYS: `safety-v1:${readLocalStackFile(safetyIdentifierKeyPath).toString('hex')}`,
    AI_SUBJECT_HMAC_KEYS: `subject-v1:${readLocalStackFile(subjectHmacKeyPath).toString('hex')}`,
    AI_ADMISSION_ED25519_KID: admissionKid,
    AI_ADMISSION_ED25519_PRIVATE_KEY_B64: privateKeyBase64(admissionPrivateKeyPath),
    AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON: JSON.stringify({
      [admissionKid]: publicKeyBase64(admissionPrivateKeyPath),
    }),
    AI_PROVENANCE_ED25519_KID: provenanceKid,
    AI_PROVENANCE_ED25519_PRIVATE_KEY_B64: privateKeyBase64(provenancePrivateKeyPath),
    AI_PROVENANCE_ED25519_PUBLIC_KEYS_JSON: JSON.stringify({
      [provenanceKid]: publicKeyBase64(provenancePrivateKeyPath),
    }),
    AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
    AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST: AI_PROVIDER_DEPLOYMENT_PROFILE.profileDigest,
    AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST: AI_RUNTIME_CAPABILITIES_V1_DIGEST,
  }
}

function prepare(mode: LocalStackMode, clearArtifacts = false): StackPaths {
  const state = paths(mode)
  if (clearArtifacts) {
    rmSync(state.root, { recursive: true, force: true })
    rmSync(state.artifacts, { recursive: true, force: true })
    rmSync(state.hostSeedState, { force: true })
  }
  mkdirSync(state.root, { recursive: true })
  mkdirSync(state.artifacts, { recursive: true })
  mkdirSync(state.acceptance, { recursive: true })
  mkdirSync(state.e2eArtifacts, { recursive: true })
  chmodSync(state.e2eArtifacts, 0o777)
  // Same bind-mount uid mismatch as e2eArtifacts, one directory deeper. The
  // perf-runner image runs as USER node (uid 1000) while the host artifact tree
  // is owned by whoever ran the stack — the CI runner user on Linux. Docker
  // Desktop's uid mapping hides this on macOS, so it only ever failed in CI:
  // `seed-scale failed: EACCES: permission denied, mkdir '/artifacts/perf'`.
  // Creating it here, writable, means the container never has to mkdir it.
  mkdirSync(state.perfArtifacts, { recursive: true })
  chmodSync(state.artifacts, 0o777)
  chmodSync(state.perfArtifacts, 0o777)
  const releaseSha = revision()
  const baseEnv = buildLocalStackEnv({
    mode,
    revision: releaseSha,
    artifactDir: state.artifacts,
    e2eDir: state.e2eArtifacts,
  })
  prepareProviderRedisAssets(state, baseEnv.PROVIDER_EPHEMERAL_REDIS_PASSWORD!)
  const env = {
    ...baseEnv,
    GOOGLE_EGRESS_GATEWAY_IDENTITY: 'local-google-provider-runtime-v1',
    ...prepareLocalAiRuntimeEnv(state),
  }
  writeFileSync(state.env, serializeEnv(env), { mode: 0o600 })
  chmodSync(state.env, 0o600)
  return state
}

function composeArgs(mode: LocalStackMode, state: StackPaths): string[] {
  return [
    'compose',
    '--env-file',
    state.env,
    '--file',
    COMPOSE_FILE,
    '--project-name',
    localStackProject(mode),
    '--profile',
    'backend',
    '--profile',
    'frontend',
  ]
}

function run(command: string, args: readonly string[], options: RunOptions = {}): string {
  const result = spawnSync(command, [...args], {
    cwd: ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFailure) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status ?? 'without a status'}` +
        (detail ? `\n${detail}` : ''),
    )
  }
  return `${result.stdout ?? ''}${options.includeStderr ? (result.stderr ?? '') : ''}`
}

function dockerCompose(
  mode: LocalStackMode,
  state: StackPaths,
  args: readonly string[],
  options?: RunOptions,
): string {
  return run('docker', [...composeArgs(mode, state), ...args], options)
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve: done } = Promise.withResolvers<void>()
  setTimeout(done, ms)
  return promise
}

async function probeHttp(
  url: string,
): Promise<Readonly<{ reachable: boolean; status: number | null }>> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) })
    return { reachable: true, status: response.status }
  } catch {
    return { reachable: false, status: null }
  }
}

async function waitHttp(name: string, url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last = 'no response'
  while (Date.now() < deadline) {
    const observation = await probeHttp(url)
    if (
      observation.status != null &&
      observation.status >= 200 &&
      observation.status < 300
    ) {
      return
    }
    last = observation.status == null ? 'connection failed' : `HTTP ${observation.status}`
    await sleep(1_000)
  }
  throw new Error(`${name} did not become healthy at ${url}: ${last}`)
}

async function probeTcp(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolveProbe) => {
    const socket = connect({ host: '127.0.0.1', port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolveProbe(false)
    }, 2_000)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolveProbe(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolveProbe(false)
    })
  })
}

function workerContainerState(
  mode: LocalStackMode,
  state: StackPaths,
): WorkerContainerState | null {
  const containerId = dockerCompose(mode, state, ['ps', '--all', '--quiet', 'worker'], {
    capture: true,
    allowFailure: true,
  }).trim()
  if (!containerId) return null

  const startedAt = run(
    'docker',
    ['inspect', '--format', '{{.State.StartedAt}}', containerId],
    { capture: true, allowFailure: true },
  ).trim()
  const startedAtMs = Date.parse(startedAt)
  if (!Number.isFinite(startedAtMs)) return null

  return { id: containerId, startedAtMs }
}

function workerReadyCount(
  mode: LocalStackMode,
  state: StackPaths,
  containerState: WorkerContainerState | null = null,
): number {
  const current = containerState ?? workerContainerState(mode, state)
  if (!current) return 0

  const logs = run(
    'docker',
    [
      'logs',
      '--since',
      new Date(current.startedAtMs).toISOString(),
      '--until',
      new Date(current.startedAtMs + 120_000).toISOString(),
      current.id,
    ],
    { capture: true, allowFailure: true, includeStderr: true },
  )
  return logs.split(WORKER_READY_LINE).length - 1
}

async function waitWorker(
  mode: LocalStackMode,
  state: StackPaths,
  minimumReadyCount = 1,
): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (workerReadyCount(mode, state) >= minimumReadyCount) return
    await sleep(1_000)
  }
  throw new Error(`worker did not emit readiness line: ${WORKER_READY_LINE}`)
}

async function waitWorkerRestart(
  mode: LocalStackMode,
  state: StackPaths,
  priorState: WorkerContainerState | null,
): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const current = workerContainerState(mode, state)
    const restarted =
      priorState === null ||
      current?.id !== priorState.id ||
      current?.startedAtMs > priorState.startedAtMs
    if (restarted && current !== null && workerReadyCount(mode, state, current) >= 1) {
      return
    }
    await sleep(1_000)
  }
  throw new Error(`worker did not emit readiness line: ${WORKER_READY_LINE}`)
}

function serviceNetworks(
  mode: LocalStackMode,
  state: StackPaths,
  service: string,
): readonly string[] {
  const id = dockerCompose(mode, state, ['ps', '--all', '--quiet', service], {
    capture: true,
  }).trim()
  if (!id) throw new Error(`network inspection found no ${service} container`)
  const inspected = JSON.parse(
    run('docker', ['inspect', id], { capture: true }),
  ) as DockerInspect
  const networks = inspected[0]?.NetworkSettings.Networks
  if (!networks) throw new Error(`network inspection failed for ${service}`)
  return Object.keys(networks).sort()
}

function assertTcpRoute(
  mode: LocalStackMode,
  state: StackPaths,
  input: Readonly<{
    source: string
    host: string
    port: number
    reachable: boolean
  }>,
): void {
  const probe = [
    "const net=require('node:net')",
    'const [host,port,mode]=process.argv.slice(1)',
    'let settled=false',
    "const done=(connected)=>{if(settled)return;settled=true;s.destroy();process.exit(connected===(mode==='allow')?0:1)}",
    'const s=net.connect({host,port:Number(port)},()=>done(true))',
    "s.once('error',()=>done(false))",
    's.setTimeout(1500,()=>done(false))',
  ].join(';')
  dockerCompose(mode, state, [
    'exec',
    '-T',
    input.source,
    'node',
    '-e',
    probe,
    input.host,
    String(input.port),
    input.reachable ? 'allow' : 'deny',
  ])
}

function assertProviderIsolationTopology(mode: LocalStackMode, state: StackPaths): void {
  const project = localStackProject(mode)
  const expected: Readonly<Record<string, readonly string[]>> = {
    web: ['ai-provider-egress', 'app', 'provider-egress', 'provider-ephemeral'],
    'web-locked': ['ai-provider-egress', 'app', 'provider-ephemeral'],
    worker: ['ai-provider-egress', 'app', 'provider-egress', 'provider-ephemeral'],
    'perf-runner': ['ai-provider-egress', 'app', 'provider-egress', 'provider-ephemeral'],
    'provider-redis': ['provider-redis-data'],
    'provider-redis-ingress': ['provider-ephemeral', 'provider-redis-data'],
    'provider-sandbox': ['provider-egress'],
    'provider-control-proxy': ['provider-control', 'provider-egress'],
    'ai-provider-stub': ['ai-provider-egress'],
  }
  const observed = Object.fromEntries(
    Object.entries(expected).map(([service, networks]) => {
      const expectedNames = networks.map((network) => `${project}_${network}`).sort()
      const actual = serviceNetworks(mode, state, service)
      if (JSON.stringify(actual) !== JSON.stringify(expectedNames)) {
        throw new Error(
          `${service} network isolation mismatch: ${JSON.stringify({ actual, expected: expectedNames })}`,
        )
      }
      return [service, actual]
    }),
  )
  const routes = [
    { source: 'web', host: 'provider-sandbox', port: 4100, reachable: true },
    { source: 'web', host: 'provider-redis', port: 6379, reachable: false },
    {
      source: 'web',
      host: 'provider-redis-ingress',
      port: 6379,
      reachable: true,
    },
    { source: 'web', host: 'ai-provider-stub', port: 4102, reachable: true },
    {
      source: 'web-locked',
      host: 'ai-provider-stub',
      port: 4102,
      reachable: true,
    },
    { source: 'worker', host: 'provider-sandbox', port: 4100, reachable: true },
    { source: 'worker', host: 'provider-redis', port: 6379, reachable: false },
    {
      source: 'worker',
      host: 'provider-redis-ingress',
      port: 6379,
      reachable: true,
    },
    { source: 'worker', host: 'ai-provider-stub', port: 4102, reachable: true },
    {
      source: 'perf-runner',
      host: 'ai-provider-stub',
      port: 4102,
      reachable: true,
    },
    {
      source: 'ai-provider-stub',
      host: 'postgres',
      port: 5432,
      reachable: false,
    },
    {
      source: 'ai-provider-stub',
      host: 'provider-redis-ingress',
      port: 6379,
      reachable: false,
    },
  ] as const
  for (const route of routes) assertTcpRoute(mode, state, route)
  writeEvidence(state, 'provider-isolation-topology', {
    checkedAt: new Date().toISOString(),
    observed,
    routes,
  })
}

function envMap(values: readonly string[]): Map<string, string> {
  return new Map(
    values.map((entry) => {
      const separator = entry.indexOf('=')
      return separator < 0
        ? ([entry, ''] as const)
        : ([entry.slice(0, separator), entry.slice(separator + 1)] as const)
    }),
  )
}

function inspectIdentities(
  mode: LocalStackMode,
  state: StackPaths,
): ObservedImageIdentities {
  const env = parseEnvFile(state.env)
  const selected: Array<
    readonly ['web' | 'worker' | 'provider' | 'perf', ObservedImageIdentities['web']]
  > = []
  const evidenceKey: Readonly<
    Partial<Record<(typeof APP_SERVICES)[number], 'web' | 'worker' | 'provider' | 'perf'>>
  > = {
    web: 'web',
    worker: 'worker',
    'provider-sandbox': 'provider',
    'perf-runner': 'perf',
  }
  for (const service of APP_SERVICES) {
    const id = dockerCompose(mode, state, ['ps', '--all', '--quiet', service], {
      capture: true,
    }).trim()
    if (!id) throw new Error(`identity inspection found no ${service} container`)
    const parsed = JSON.parse(
      run('docker', ['inspect', id], { capture: true }),
    ) as DockerInspect
    const container = parsed[0]
    const config = container?.Config
    if (!container || !config)
      throw new Error(`identity inspection failed for ${service}`)
    if (config.User !== 'node') {
      throw new Error(
        `${service} must run as node; Docker configured ${config.User || 'root'}`,
      )
    }
    if (config.Labels['org.opencontainers.image.revision'] !== env.SOURCE_REVISION) {
      throw new Error(`${service} image revision label does not match SOURCE_REVISION`)
    }
    const containerEnv = envMap(config.Env)
    if (
      !service.includes('sandbox') &&
      !service.endsWith('-stub') &&
      containerEnv.get('RELEASE_SHA') !== env.SOURCE_REVISION
    ) {
      throw new Error(`${service} RELEASE_SHA does not match SOURCE_REVISION`)
    }
    const key = evidenceKey[service]
    if (key) {
      const image = (
        JSON.parse(
          run('docker', ['image', 'inspect', container.Image], { capture: true }),
        ) as DockerImageInspect
      )[0]
      const revisionLabel = image?.Config.Labels['org.opencontainers.image.revision']
      if (
        !image ||
        revisionLabel !== env.SOURCE_REVISION ||
        !image.Id.startsWith('sha256:')
      ) {
        throw new Error(`${service} image identity is not a revision-bound sha256`)
      }
      selected.push([
        key,
        {
          imageId: image.Id,
          repoDigests: image.RepoDigests ?? [],
          revisionLabel,
        },
      ])
    }
  }
  return Object.fromEntries(selected) as ObservedImageIdentities
}

function copySeedState(state: StackPaths): void {
  const generated = resolve(state.e2eArtifacts, '.seed-state.json')
  if (!existsSync(generated)) throw new Error(`seed did not write ${generated}`)
  copyFileSync(generated, state.hostSeedState)
}

function collectDiagnostics(mode: LocalStackMode, state: StackPaths): void {
  if (!existsSync(state.env)) return
  mkdirSync(state.artifacts, { recursive: true })
  const logs = dockerCompose(mode, state, ['logs', '--no-color', '--timestamps'], {
    capture: true,
    allowFailure: true,
    includeStderr: true,
  })
  const diagnosticId = `${Date.now()}-${mode}`
  writeFileSync(resolve(state.artifacts, 'compose.log'), logs, { flag: 'a' })
  writeFileSync(resolve(state.artifacts, `compose-${diagnosticId}.log`), logs)
  const ps = dockerCompose(mode, state, ['ps', '--all', '--format', 'json'], {
    capture: true,
    allowFailure: true,
  })
  writeFileSync(resolve(state.artifacts, 'compose-ps.jsonl'), ps, { flag: 'a' })
  writeFileSync(resolve(state.artifacts, `compose-ps-${diagnosticId}.jsonl`), ps)
}

function writeEvidence(state: StackPaths, name: string, value: unknown): string {
  mkdirSync(state.acceptance, { recursive: true })
  const json = `${JSON.stringify(value, null, 2)}\n`
  const digest = sha256(json)
  const path = resolve(state.acceptance, `${name}.json`)
  writeFileSync(path, json, 'utf8')
  writeFileSync(`${path}.sha256`, `${digest}  ${basename(path)}\n`, 'utf8')
  console.log(JSON.stringify({ evidence: path, sha256: digest }))
  return digest
}

function queryDb(mode: LocalStackMode, state: StackPaths, sql: string): string {
  const env = parseEnvFile(state.env)
  return dockerCompose(
    mode,
    state,
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-XAt',
      '-q',
      '-F',
      '\t',
      '-U',
      env.POSTGRES_USER,
      '-d',
      env.POSTGRES_DB,
      '-c',
      sql,
    ],
    { capture: true },
  ).trim()
}

function migrationHeadProof(
  mode: LocalStackMode,
  state: StackPaths,
  runKind: 'clean' | 'upgrade',
): MigrationHeadProof {
  const expected = expectedMigrationHead(JOURNAL_FILE, MIGRATION_DIR)
  const raw = queryDb(
    mode,
    state,
    `SELECT count(*)::text || E'\\t' || COALESCE((array_agg(hash ORDER BY created_at DESC))[1], '') || E'\\t' || COALESCE(max(created_at), 0)::text FROM drizzle.__drizzle_migrations`,
  )
  const [count, hash, when] = raw.split('\t')
  const proof = createMigrationHeadProof({
    runKind,
    expected,
    appliedCount: Number(count),
    appliedHash: hash ?? '',
    appliedWhen: Number(when),
  })
  if (!proof.matched)
    throw new Error(`Migration ${runKind} head does not match ${expected.tag}`)
  return proof
}

function oneShot(
  mode: LocalStackMode,
  state: StackPaths,
  service: 'object-store-init' | 'migrator' | 'google-admission-role' | 'seed',
): void {
  dockerCompose(mode, state, [
    'up',
    '--no-deps',
    '--force-recreate',
    '--abort-on-container-exit',
    '--exit-code-from',
    service,
    service,
  ])
}

function buildImages(mode: LocalStackMode, state: StackPaths): void {
  dockerCompose(mode, state, ['config', '--quiet'])
  // Every service in the active profiles is built here, perf-runner included.
  //
  // Skipping perf-runner for e2e was tried and measured pointless: it sits in
  // the `backend` profile, so `docker compose up` needs its image anyway, finds
  // it missing, attempts a registry pull ("pull access denied for
  // repkey-local-perf"), and then builds it during startup regardless. The work
  // does not disappear, it just moves out of this phase and gains a failed pull
  // round trip. Building it explicitly here keeps the boot log honest.
  //
  // COMPOSE_PARALLEL_LIMIT: compose builds every service at once by default,
  // and each of these stages runs its own `pnpm install --frozen-lockfile`.
  // Too many concurrent stages exhausted a 4 GiB Docker VM: the guest kernel
  // logged `global_oom` and killed whatever was largest, twice taking `dockerd`
  // itself, which surfaces to the client as the useless
  // `failed to solve: Unavailable: error reading from server: EOF`. Capping the
  // fan-out costs wall clock on a big machine and is the difference between
  // booting and not on a small one.
  dockerCompose(
    mode,
    state,
    ['build', 'web', 'worker', 'seed', 'provider-sandbox', 'perf-runner'],
    { env: { ...process.env, COMPOSE_PARALLEL_LIMIT: '3' } },
  )
}

function startDependencies(mode: LocalStackMode, state: StackPaths): void {
  dockerCompose(mode, state, [
    'up',
    '--detach',
    '--force-recreate',
    '--wait',
    '--wait-timeout',
    '180',
    'postgres',
    'redis',
    'queue-redis',
    'provider-redis',
    'provider-redis-ingress',
    'object-store',
    'provider-sandbox',
    'provider-control-proxy',
    'mail-stub',
    'ai-provider-stub',
  ])
}

/** Provision the Google admission role after the migrator creates its procedures. */
function provisionGoogleAdmissionRole(mode: LocalStackMode, state: StackPaths): void {
  oneShot(mode, state, 'google-admission-role')
}

function sanitationEvidence(
  mode: LocalStackMode,
  state: StackPaths,
): Record<string, unknown> {
  const publicTables = Number(
    queryDb(mode, state, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public'`),
  )
  const cacheRedisKeys = Number(
    dockerCompose(mode, state, ['exec', '-T', 'redis', 'redis-cli', '--raw', 'DBSIZE'], {
      capture: true,
    }).trim(),
  )
  const queueRedisKeys = Number(
    dockerCompose(
      mode,
      state,
      ['exec', '-T', 'queue-redis', 'redis-cli', '--raw', 'DBSIZE'],
      { capture: true },
    ).trim(),
  )
  oneShot(mode, state, 'object-store-init')
  const objectOutput = dockerCompose(
    mode,
    state,
    [
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      '/bin/sh',
      'object-store-init',
      '-ec',
      'mc alias set local http://object-store:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; count=$(mc find "local/$S3_BUCKET_NAME" --type f | wc -l); echo "OBJECT_COUNT=$count"',
    ],
    { capture: true },
  )
  const objectCount = Number(/OBJECT_COUNT=(\d+)/.exec(objectOutput)?.[1] ?? -1)
  const envMode = statSync(state.env).mode & 0o777
  const evidence = {
    volumesRecreated: true,
    publicTablesBeforeMigration: publicTables,
    cacheRedisKeysBeforeApplication: cacheRedisKeys,
    redisKeysBeforeApplication: queueRedisKeys,
    objectCountBeforeApplication: objectCount,
    generatedEnvironmentMode: envMode.toString(8),
    noStaleDatabase: publicTables === 0,
    noStaleRedisCache: cacheRedisKeys === 0,
    noStaleRedisQueue: queueRedisKeys === 0,
    noStaleObjects: objectCount === 0,
    protectedGeneratedSecrets: envMode === 0o600,
  }
  if (
    !evidence.noStaleDatabase ||
    !evidence.noStaleRedisCache ||
    !evidence.noStaleRedisQueue ||
    !evidence.noStaleObjects ||
    !evidence.protectedGeneratedSecrets
  ) {
    throw new Error(`Hermetic sanitation failed: ${JSON.stringify(evidence)}`)
  }
  return evidence
}

async function startApplications(mode: LocalStackMode, state: StackPaths): Promise<void> {
  oneShot(mode, state, 'seed')
  dockerCompose(mode, state, [
    'up',
    '--no-deps',
    '--detach',
    '--force-recreate',
    '--wait',
    '--wait-timeout',
    '180',
    'web',
    'web-locked',
    'worker',
    'perf-runner',
  ])
  await waitWorker(mode, state)
}

async function smoke(mode: LocalStackMode, state: StackPaths): Promise<void> {
  await Promise.all([
    waitHttp('GBP stub', 'http://127.0.0.1:4100/__control/health'),
    waitHttp('mail stub', 'http://127.0.0.1:4101/__control/health'),
    waitHttp('object store', 'http://127.0.0.1:4900/minio/health/live'),
    waitHttp('web', 'http://127.0.0.1:3000/api/health/started'),
    waitHttp('locked web', 'http://127.0.0.1:3001/api/health/started'),
  ])
  await waitWorker(mode, state)
  inspectIdentities(mode, state)
  copySeedState(state)
  assertProviderIsolationTopology(mode, state)
}

function removeProject(mode: LocalStackMode, state: StackPaths): void {
  if (!existsSync(state.env)) return
  dockerCompose(
    mode,
    state,
    ['down', '--volumes', '--remove-orphans', '--timeout', '15'],
    { allowFailure: true },
  )
}

async function up(
  mode: LocalStackMode,
  options: Readonly<{ cleanStart?: boolean; preserveArtifacts?: boolean }> = {},
): Promise<Readonly<{ state: StackPaths; sanitation?: Record<string, unknown> }>> {
  run('docker', ['version'], { capture: true })
  run('docker', ['compose', 'version'], { capture: true })
  let state = prepare(mode)
  if (options.cleanStart) {
    removeProject(mode, state)
    rmSync(state.root, { recursive: true, force: true })
    if (!options.preserveArtifacts) {
      rmSync(state.artifacts, { recursive: true, force: true })
    }
    rmSync(state.hostSeedState, { force: true })
    state = prepare(mode)
  }
  try {
    buildImages(mode, state)
    startDependencies(mode, state)
    const sanitation = options.cleanStart ? sanitationEvidence(mode, state) : undefined
    if (!options.cleanStart) oneShot(mode, state, 'object-store-init')
    oneShot(mode, state, 'migrator')
    provisionGoogleAdmissionRole(mode, state)
    await startApplications(mode, state)
    await smoke(mode, state)
    return { state, sanitation }
  } catch (error) {
    collectDiagnostics(mode, state)
    throw error
  }
}

function down(mode: LocalStackMode): void {
  const state = paths(mode)
  if (!existsSync(state.env)) {
    console.log(`Local ${mode} stack has no generated environment; nothing to stop`)
    return
  }
  collectDiagnostics(mode, state)
  removeProject(mode, state)
  rmSync(state.env, { force: true })
  rmSync(state.hostSeedState, { force: true })
}

function playwrightEnv(state: StackPaths): NodeJS.ProcessEnv {
  return { ...process.env, ...localStackPlaywrightEnv(state.env) }
}

async function test(mode: LocalStackMode): Promise<void> {
  const { state } = await up(mode, { cleanStart: true })
  try {
    const env = playwrightEnv(state)
    run('pnpm', ['test:e2e', '--project=critical'], { env })
    run('pnpm', ['test:e2e', '--project=full'], { env })
  } catch (error) {
    collectDiagnostics(mode, state)
    throw error
  } finally {
    down(mode)
  }
}

async function cleanSmoke(
  mode: LocalStackMode,
  preserveArtifacts = false,
): Promise<string> {
  const { state, sanitation } = await up(mode, {
    cleanStart: true,
    preserveArtifacts,
  })
  try {
    const head = migrationHeadProof(mode, state, 'clean')
    const images = inspectIdentities(mode, state)
    return writeEvidence(state, 'clean-smoke', {
      schemaVersion: 'beta-local-1',
      evidenceKind: 'local-production-profile-clean-smoke',
      sourceRevision: revision(),
      project: localStackProject(mode),
      sanitation,
      migrationHead: head,
      revisionIdentityChecked: true,
      images,
      exclusions: ['hosted-capacity', 'managed-pitr', 'production-region'],
    })
  } finally {
    down(mode)
  }
}

function parseJsonBytes(bytes: Buffer): unknown {
  return JSON.parse(bytes.toString('utf8')) as unknown
}

function readJson(path: string): unknown {
  return parseJsonBytes(readLocalStackFile(path))
}

async function scale(mode: LocalStackMode, preserveArtifacts = false): Promise<string> {
  const { state, sanitation } = await up(mode, {
    cleanStart: true,
    preserveArtifacts,
  })
  try {
    const scaleManifest = '/artifacts/perf/scale-dataset.json'
    const runner = (entry: 'seed-scale' | 'seed-fleet', args: readonly string[]) =>
      dockerCompose(mode, state, [
        'exec',
        '-T',
        'perf-runner',
        'node',
        `dist-perf-runner/perf/${entry}.js`,
        ...args,
      ])
    runner('seed-scale', [
      '--seed=beta-local-scale-v1',
      '--orgs=100',
      '--properties=5000',
      '--reviews=500000',
      '--source-lifecycle',
      `--manifest=${scaleManifest}`,
    ])
    runner('seed-scale', [
      '--seed=beta-local-scale-v1',
      '--orgs=100',
      '--properties=5000',
      '--reviews=500000',
      '--source-lifecycle',
      `--manifest=${scaleManifest}`,
      '--verify',
    ])
    runner('seed-scale', [
      '--seed=beta-local-scale-v1',
      '--orgs=100',
      '--properties=5000',
      '--reviews=500000',
      '--source-lifecycle',
      `--manifest=${scaleManifest}`,
      '--clean',
    ])
    runner('seed-fleet', [
      '--seed=beta-local-fleet-v1',
      '--properties=5000',
      '--artifact=/artifacts/perf/fleet-fixture.json',
    ])
    const scaleEvidencePath = resolve(state.artifacts, 'perf/scale-dataset.json')
    const fleetEvidencePath = resolve(state.artifacts, 'perf/fleet-fixture.json')
    // Each fixture is read once and both the embedded value and the recorded
    // digest come from that one buffer. Reading the path twice — once to parse,
    // once to hash — let the evidence claim a sha256 over bytes it did not
    // actually publish.
    const scaleEvidenceBytes = readLocalStackFile(scaleEvidencePath)
    const fleetEvidenceBytes = readLocalStackFile(fleetEvidencePath)
    return writeEvidence(state, 'scale', {
      schemaVersion: 'beta-local-1',
      evidenceKind: 'synthetic-local-scale-and-bounded-query',
      sourceRevision: revision(),
      sanitation,
      migrationHead: migrationHeadProof(mode, state, 'clean'),
      scaleFixture: parseJsonBytes(scaleEvidenceBytes),
      scaleFixtureFileSha256: sha256(scaleEvidenceBytes),
      fleetFixture: parseJsonBytes(fleetEvidenceBytes),
      fleetFixtureFileSha256: sha256(fleetEvidenceBytes),
      exclusions: ['hosted-capacity', 'managed-pitr', 'production-region'],
    })
  } finally {
    down(mode)
  }
}
async function resetExternalEffectCounts(): Promise<void> {
  const responses = await Promise.all([
    fetch('http://127.0.0.1:4100/__control/reset', { method: 'POST' }),
    fetch('http://127.0.0.1:4101/__control/reset', { method: 'POST' }),
  ])
  const failed = responses.find((response) => !response.ok)
  if (failed) {
    throw new Error(`External-effect stub reset failed with HTTP ${failed.status}`)
  }
}

async function externalEffectCounts(): Promise<
  Readonly<{ gbpCalls: number; mailSends: number }>
> {
  const [gbp, mail] = await Promise.all([
    fetch('http://127.0.0.1:4100/__control/calls').then((response) =>
      response.json(),
    ) as Promise<{
      calls: readonly unknown[]
    }>,
    fetch('http://127.0.0.1:4101/__control/sends').then((response) =>
      response.json(),
    ) as Promise<{
      sends: readonly unknown[]
    }>,
  ])
  return { gbpCalls: gbp.calls.length, mailSends: mail.sends.length }
}

function durableCounts(
  mode: LocalStackMode,
  state: StackPaths,
): Readonly<{ outbox: number; receipts: number }> {
  const [outbox, receipts] = queryDb(
    mode,
    state,
    `SELECT (SELECT count(*) FROM outbox_events)::text || E'\\t' || (SELECT count(*) FROM event_consumer_receipts)::text`,
  ).split('\t')
  return { outbox: Number(outbox), receipts: Number(receipts) }
}

async function waitForDurableQuiescence(
  mode: LocalStackMode,
  state: StackPaths,
): Promise<Readonly<{ outbox: number; receipts: number }>> {
  const deadline = Date.now() + 60_000
  let previous = durableCounts(mode, state)
  while (Date.now() < deadline) {
    await sleep(2_000)
    const current = durableCounts(mode, state)
    if (current.outbox === previous.outbox && current.receipts === previous.receipts) {
      return current
    }
    previous = current
  }
  throw new Error('Outbox/receipt counts did not quiesce before fault injection')
}
function runAffectedOperation(
  mode: LocalStackMode,
  state: StackPaths,
  dependency: Exclude<(typeof FAULTS)[number]['name'], 'worker'>,
  phase: 'fault' | 'recovery',
): Record<string, unknown> {
  const output = dockerCompose(
    mode,
    state,
    [
      'exec',
      '-T',
      'perf-runner',
      'node',
      'dist-perf-runner/local-stack/fault-operation.js',
      dependency,
      phase,
    ],
    { capture: true },
  )
  const evidence = selectProbeEvidence(output, dependency, phase)
  if (!evidence) {
    throw new Error(
      `${dependency} ${phase} probe returned no evidence; last stdout line was ` +
        `${JSON.stringify(output.trim().split('\n').at(-1) ?? '')}`,
    )
  }
  return evidence
}

function enqueueReviewCreatedProbe(mode: LocalStackMode, state: StackPaths): string {
  return queryDb(
    mode,
    state,
    `WITH source AS (
       SELECT id, organization_id, property_id, platform,
              COALESCE(source_revision, 1) AS source_revision,
              COALESCE(source_epoch, 0) AS source_epoch,
              GREATEST(analysis_sequence, 1) AS analysis_sequence
       FROM reviews ORDER BY created_at, id LIMIT 1
     )
     INSERT INTO outbox_events (
       event_type, event_version, payload, organization_id, property_id,
       source_context, source_aggregate_id
     )
     SELECT 'review.created', 1,
       jsonb_build_object(
         'reviewId', id, 'organizationId', organization_id,
         'propertyId', property_id, 'platform', platform,
         'sourceEpoch', source_epoch, 'sourceRevision', source_revision,
         'analysisSequence', analysis_sequence, 'occurredAt', now()
       ),
       organization_id, property_id, 'local-fault-probe', id::text
     FROM source RETURNING id`,
  ).trim()
}

function eventDelivery(
  mode: LocalStackMode,
  state: StackPaths,
  eventId: string,
): Readonly<{ published: boolean; receipts: number }> {
  const [published, receipts] = queryDb(
    mode,
    state,
    `SELECT (published_at IS NOT NULL)::text || E'\\t' ||
       (SELECT count(*) FROM event_consumer_receipts WHERE event_id = outbox_events.id)::text
     FROM outbox_events WHERE id = '${eventId}'::uuid`,
  ).split('\t')
  return {
    published: published === 't' || published === 'true',
    receipts: Number(receipts),
  }
}

/**
 * Waits for a delivery to SETTLE, not merely to start.
 *
 * `event_consumer_receipts` is keyed `(event_id, consumer_name)`, and the probe
 * event (`review.created`) has two durable consumers —
 * `inbox.on-review-created` and `ai.analyze-review-event`. Returning at the
 * first receipt therefore handed the caller an unfinished fan-out, which it
 * then compared against a post-replay steady state: `beta-acceptance` failed
 * with `first: 1` / `replay: 2` even though that primary key makes a genuine
 * duplicate impossible, and `noDuplicateExternalEffect` was true in the same
 * observation. The race was in the assertion, not the system.
 *
 * So require the count to hold still before returning. Both sides of the
 * idempotence comparison are then steady states, which is what makes
 * "the replay added nothing" mean anything.
 */
async function waitForEventDelivery(
  mode: LocalStackMode,
  state: StackPaths,
  eventId: string,
): Promise<Readonly<{ published: boolean; receipts: number }>> {
  const SETTLE_POLLS = 3
  const deadline = Date.now() + 60_000
  let last = -1
  let stableFor = 0
  while (Date.now() < deadline) {
    const delivery = eventDelivery(mode, state, eventId)
    if (delivery.published && delivery.receipts > 0) {
      stableFor = delivery.receipts === last ? stableFor + 1 : 0
      last = delivery.receipts
      if (stableFor >= SETTLE_POLLS) return delivery
    }
    await sleep(1_000)
  }
  throw new Error(`Queued mutation ${eventId} did not drain after worker recovery`)
}

async function observeFault(
  mode: LocalStackMode,
  state: StackPaths,
  fault: (typeof FAULTS)[number],
): Promise<FaultObservation> {
  await resetExternalEffectCounts()
  const externalBefore = await externalEffectCounts()
  const durableBefore = await waitForDurableQuiescence(mode, state)
  const workerStateBefore = workerContainerState(mode, state)
  if (fault.name === 'worker') {
    dockerCompose(mode, state, ['stop', '--timeout', '10', 'web', 'worker'])
    const eventId = enqueueReviewCreatedProbe(mode, state)
    const queued = eventDelivery(mode, state, eventId)
    const externalAfterFailedOperation = await externalEffectCounts()
    const readinessDuringFault = await probeHttp('http://127.0.0.1:3000/api/health/ready')
    const readinessIs2xx =
      readinessDuringFault.reachable &&
      readinessDuringFault.status !== null &&
      readinessDuringFault.status >= 200 &&
      readinessDuringFault.status < 300
    const failClosed = !queued.published && queued.receipts === 0 && !readinessIs2xx
    dockerCompose(mode, state, [
      'up',
      '--no-deps',
      '--detach',
      '--wait',
      '--wait-timeout',
      '180',
      'web',
      'worker',
    ])
    await waitWorkerRestart(mode, state, workerStateBefore)
    await waitHttp(
      'web readiness after queued restart',
      'http://127.0.0.1:3000/api/health/ready',
    )
    const first = await waitForEventDelivery(mode, state, eventId)
    queryDb(
      mode,
      state,
      `UPDATE outbox_events SET published_at=NULL, lease_owner=NULL, leased_at=NULL, lease_expires_at=NULL WHERE id='${eventId}'::uuid`,
    )
    const replay = await waitForEventDelivery(mode, state, eventId)
    const externalAfter = await externalEffectCounts()
    const durableAfter = await waitForDurableQuiescence(mode, state)
    const noDuplicateExternalEffect =
      externalBefore.gbpCalls === externalAfter.gbpCalls &&
      externalBefore.mailSends === externalAfter.mailSends
    const idempotentRestart = first.receipts === replay.receipts && replay.receipts > 0
    if (!failClosed || !noDuplicateExternalEffect || !idempotentRestart) {
      throw new Error(
        `worker queued-restart assertion failed: ${JSON.stringify({ eventId, queued, first, replay, noDuplicateExternalEffect })}`,
      )
    }
    return {
      fault: fault.name,
      service: fault.service,
      operationDuringFault: {
        dependency: 'worker',
        phase: 'fault',
        observed: 'queued-unprocessed',
      },
      operationAfterRecovery: {
        dependency: 'worker',
        phase: 'recovery',
        observed: 'processed-and-idempotently-replayed',
      },
      dependencyUnavailableObserved: true,
      readinessDuringFault,
      failClosed,
      recovered: first.published,
      externalEffectsBefore: externalBefore,
      externalEffectsAfterFailedOperation: externalAfterFailedOperation,
      externalEffectsAfter: externalAfter,
      noDuplicateExternalEffect,
      durableCountsBefore: durableBefore,
      durableCountsAfter: durableAfter,
      idempotentRestart,
    }
  }

  dockerCompose(mode, state, ['stop', '--timeout', '10', fault.service])
  const operationDuringFault = runAffectedOperation(mode, state, fault.name, 'fault')
  const unavailable =
    fault.name === 'gbp' || fault.name === 'web'
      ? operationDuringFault.observed !== 'success'
      : fault.endpoint === 'operation'
        ? operationDuringFault.observed === 'failed-closed'
        : fault.endpoint === 'http'
          ? !(await probeHttp(fault.url)).reachable
          : !(await probeTcp(
              fault.name === 'db'
                ? Number(parseEnvFile(state.env).POSTGRES_HOST_PORT)
                : Number(parseEnvFile(state.env).REDIS_HOST_PORT),
            ))
  const readinessDuringFault = await probeHttp('http://127.0.0.1:3000/api/health/ready')
  let failClosed = unavailable && operationDuringFault.observed === 'failed-closed'
  dockerCompose(mode, state, [
    'up',
    '--no-deps',
    '--detach',
    '--wait',
    '--wait-timeout',
    '180',
    fault.service,
  ])
  if (fault.name === 'web') await waitHttp('web recovery', fault.url)
  const externalAfterFailedOperation = await externalEffectCounts()
  failClosed =
    failClosed &&
    externalBefore.gbpCalls === externalAfterFailedOperation.gbpCalls &&
    externalBefore.mailSends === externalAfterFailedOperation.mailSends
  const operationAfterRecovery = runAffectedOperation(mode, state, fault.name, 'recovery')
  const recovered =
    operationAfterRecovery.observed === 'success' &&
    (fault.endpoint === 'operation'
      ? true
      : fault.endpoint === 'http'
        ? (await probeHttp(fault.url)).status === 200
        : await probeTcp(
            fault.name === 'db'
              ? Number(parseEnvFile(state.env).POSTGRES_HOST_PORT)
              : Number(parseEnvFile(state.env).REDIS_HOST_PORT),
          ))
  await waitHttp('web readiness recovery', 'http://127.0.0.1:3000/api/health/ready')
  const externalAfter = await externalEffectCounts()
  const durableAfter = await waitForDurableQuiescence(mode, state)
  const noDuplicateExternalEffect =
    externalAfter.gbpCalls - externalBefore.gbpCalls === (fault.name === 'gbp' ? 1 : 0) &&
    externalAfter.mailSends - externalBefore.mailSends === (fault.name === 'mail' ? 1 : 0)
  const idempotentRestart =
    durableBefore.outbox === durableAfter.outbox &&
    durableBefore.receipts === durableAfter.receipts
  if (
    !unavailable ||
    !failClosed ||
    !recovered ||
    !noDuplicateExternalEffect ||
    !idempotentRestart
  ) {
    throw new Error(
      `${fault.name} fault assertion failed: ${JSON.stringify({ unavailable, operationDuringFault, operationAfterRecovery, failClosed, recovered, noDuplicateExternalEffect, idempotentRestart })}`,
    )
  }
  return {
    fault: fault.name,
    service: fault.service,
    operationDuringFault:
      operationDuringFault as FaultObservation['operationDuringFault'],
    operationAfterRecovery:
      operationAfterRecovery as FaultObservation['operationAfterRecovery'],
    dependencyUnavailableObserved: unavailable,
    readinessDuringFault,
    failClosed,
    recovered,
    externalEffectsBefore: externalBefore,
    externalEffectsAfterFailedOperation: externalAfterFailedOperation,
    externalEffectsAfter: externalAfter,
    noDuplicateExternalEffect,
    durableCountsBefore: durableBefore,
    durableCountsAfter: durableAfter,
    idempotentRestart,
  }
}

async function faults(mode: LocalStackMode, preserveArtifacts = false): Promise<string> {
  const { state, sanitation } = await up(mode, {
    cleanStart: true,
    preserveArtifacts,
  })
  try {
    const observations: FaultObservation[] = []
    for (const fault of FAULTS) observations.push(await observeFault(mode, state, fault))
    return writeEvidence(state, 'faults', {
      schemaVersion: 'beta-local-1',
      evidenceKind: 'local-application-fault-smoke',
      sourceRevision: revision(),
      sanitation,
      migrationHead: migrationHeadProof(mode, state, 'clean'),
      observations,
      assertions: {
        allFaultsObserved: observations.length === FAULTS.length,
        allFailedClosed: observations.every((item) => item.failClosed),
        allRecovered: observations.every((item) => item.recovered),
        noDuplicateExternalEffects: observations.every(
          (item) => item.noDuplicateExternalEffect,
        ),
        idempotentRestarts: observations.every((item) => item.idempotentRestart),
      },
      exclusions: ['pitr', 'hosted-capacity', 'managed-region-failover'],
    })
  } catch (error) {
    collectDiagnostics(mode, state)
    throw error
  } finally {
    down(mode)
  }
}

function restoreDump(mode: LocalStackMode, state: StackPaths, dumpPath: string): void {
  if (!existsSync(dumpPath))
    throw new Error(`Pre-cutover dump does not exist: ${dumpPath}`)
  const extension = extname(dumpPath)
  if (extension !== '.sql' && extension !== '.dump') {
    throw new Error(
      'Pre-cutover dump must be a versioned .sql or PostgreSQL custom .dump',
    )
  }
  const id = dockerCompose(mode, state, ['ps', '--quiet', 'postgres'], {
    capture: true,
  }).trim()
  if (!id) throw new Error('Postgres container is not running for upgrade restore')
  const target = `/tmp/pre-cutover${extension}`
  run('docker', ['cp', dumpPath, `${id}:${target}`])
  const env = parseEnvFile(state.env)
  const command =
    extension === '.dump'
      ? [
          'exec',
          '-T',
          'postgres',
          'pg_restore',
          '--exit-on-error',
          '--no-owner',
          '--no-privileges',
          '-U',
          env.POSTGRES_USER,
          '-d',
          env.POSTGRES_DB,
          target,
        ]
      : [
          'exec',
          '-T',
          'postgres',
          'psql',
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-U',
          env.POSTGRES_USER,
          '-d',
          env.POSTGRES_DB,
          '-f',
          target,
        ]
  dockerCompose(mode, state, command)
}

function unverifiedMigrationHead(
  mode: LocalStackMode,
  state: StackPaths,
): Record<string, unknown> {
  try {
    const raw = queryDb(
      mode,
      state,
      `SELECT count(*)::text || E'\\t' || COALESCE((array_agg(hash ORDER BY created_at DESC))[1], '') || E'\\t' || COALESCE(max(created_at), 0)::text FROM drizzle.__drizzle_migrations`,
    )
    const [count, hash, when] = raw.split('\t')
    return {
      appliedCount: Number(count),
      appliedHash: hash ?? '',
      appliedWhen: Number(when),
    }
  } catch {
    return { appliedCount: 0, appliedHash: '', appliedWhen: 0 }
  }
}
function legacyFixtureState(
  mode: LocalStackMode,
  state: StackPaths,
): Readonly<{
  fixtureVersion: string
  oldMigrationHead: string
  legacySeedState: Record<string, unknown>
}> {
  const raw = queryDb(
    mode,
    state,
    `SELECT json_build_object(
       'fixtureVersion', fixture_version,
       'oldMigrationHead', old_migration_head,
       'legacySeedState', legacy_seed_state
     )::text
     FROM public.beta_local_pre_cutover_fixture
     WHERE fixture_version = 'beta-local-1'`,
  )
  if (!raw) throw new Error('Pre-cutover legacy fixture row is missing')
  return JSON.parse(raw) as Readonly<{
    fixtureVersion: string
    oldMigrationHead: string
    legacySeedState: Record<string, unknown>
  }>
}

async function upgrade(
  mode: LocalStackMode,
  dumpPath: string,
  preserveArtifacts = false,
): Promise<string> {
  run('docker', ['version'], { capture: true })
  let state = prepare(mode)
  removeProject(mode, state)
  rmSync(state.root, { recursive: true, force: true })
  if (!preserveArtifacts) rmSync(state.artifacts, { recursive: true, force: true })
  rmSync(state.hostSeedState, { force: true })
  state = prepare(mode)
  try {
    buildImages(mode, state)
    startDependencies(mode, state)
    const sanitation = sanitationEvidence(mode, state)
    // Symlinks are allowed here: the dump path comes from the operator's own
    // `--pre-cutover-dump` flag and pointing it at a `latest.dump` link is
    // ordinary usage. The descriptor read is still what stops a FIFO at that
    // path from hanging the upgrade run. It does not make this digest a proof
    // of what `restoreDump` copies — that step resolves the path again through
    // `docker cp`, which takes a path and not this descriptor.
    const dumpSha256 = sha256(readLocalStackFile(dumpPath, { allowSymlink: true }))
    restoreDump(mode, state, dumpPath)
    const preCutoverHead = unverifiedMigrationHead(mode, state)
    const legacyBefore = legacyFixtureState(mode, state)
    const pendingUpgradeCount =
      expectedMigrationHead(JOURNAL_FILE, MIGRATION_DIR).count -
      Number(queryDb(mode, state, 'SELECT count(*) FROM drizzle.__drizzle_migrations'))
    if (pendingUpgradeCount <= 0) {
      throw new Error('Versioned upgrade fixture has no pending migrations')
    }
    oneShot(mode, state, 'migrator')
    provisionGoogleAdmissionRole(mode, state)
    await startApplications(mode, state)
    const upgradedHead = migrationHeadProof(mode, state, 'upgrade')
    const images = inspectIdentities(mode, state)
    const legacyAfter = legacyFixtureState(mode, state)
    const survived = JSON.stringify(legacyBefore) === JSON.stringify(legacyAfter)
    if (!survived) throw new Error('Legacy fixture changed during upgrade')
    return writeEvidence(state, 'upgrade', {
      schemaVersion: 'beta-local-1',
      evidenceKind: 'versioned-pre-cutover-local-upgrade',
      sourceRevision: revision(),
      dump: { file: basename(dumpPath), sha256: dumpSha256 },
      sanitation,
      preCutoverHead,
      upgradedHead,
      pendingUpgradeCount,
      legacyFixtureProof: {
        before: legacyBefore,
        after: legacyAfter,
        survived,
      },
      images,
      revisionIdentityChecked: true,
      exclusions: ['pitr', 'hosted-capacity', 'managed-region-failover'],
    })
  } catch (error) {
    collectDiagnostics(mode, state)
    throw error
  } finally {
    down(mode)
  }
}

async function acceptance(mode: LocalStackMode, dumpPath: string): Promise<void> {
  rmSync(paths(mode).artifacts, { recursive: true, force: true })
  const cleanDigest = await cleanSmoke(mode, true)
  const scaleDigest = await scale(mode, true)
  const faultDigest = await faults(mode, true)
  const upgradeDigest = await upgrade(mode, dumpPath, true)
  const state = prepare(mode)
  const clean = readJson(resolve(state.acceptance, 'clean-smoke.json')) as Record<
    string,
    unknown
  >
  const scaleEvidence = readJson(resolve(state.acceptance, 'scale.json')) as Record<
    string,
    unknown
  >
  const upgraded = readJson(resolve(state.acceptance, 'upgrade.json')) as Record<
    string,
    unknown
  >
  writeEvidence(state, 'acceptance-index', {
    schemaVersion: 'beta-local-1',
    evidenceKind: 'local-stack-acceptance-index',
    sourceRevision: revision(),
    cleanDigest,
    scaleDigest,
    faultDigest,
    upgradeDigest,
    cleanMigrationHead: clean.migrationHead,
    upgradeMigrationHead: upgraded.upgradedHead,
    stackContractSha256: sha256(readLocalStackFile(COMPOSE_FILE)),
    scaleFixtureSha256: scaleEvidence.scaleFixtureFileSha256,
    fleetFixtureSha256: scaleEvidence.fleetFixtureFileSha256,
    images: upgraded.images,
    claims: ['local-application', 'local-image', 'local-topology'],
    exclusions: ['pitr', 'hosted-capacity', 'managed-region-failover', 'pilot'],
  })
  rmSync(state.env, { force: true })
}

async function main(): Promise<void> {
  // Before anything else: every command here drives docker compose through
  // spawnSync, which fails ENOBUFS on a non-pinned Node major — after the
  // containers are up, and again in the diagnostics collector, so the symptom
  // hides the cause. Refuse up front with the fix.
  assertPinnedRuntime(ROOT)
  const command = process.argv[2] ?? 'smoke'
  const mode = parseLocalStackMode(flagValue('--mode'))
  const state = paths(mode)
  const dump = flagValue('--pre-cutover-dump')

  switch (command) {
    case 'up':
      await up(mode)
      return
    case 'smoke':
      if (!existsSync(state.env)) throw new Error(`Run local ${mode} stack up first`)
      await smoke(mode, state)
      return
    case 'logs':
      collectDiagnostics(mode, state)
      return
    case 'down':
      down(mode)
      return
    case 'reseed':
      // Flake hunting needs to run a spec N times, and most critical specs are
      // NOT re-runnable against a stack they have already mutated: guest-portal
      // replay idempotency, the product journeys and the seeded inbox rows all
      // assume first-run state. Re-running the seed one-shot restores that
      // without the ~200s of a full down/up cycle, so
      //   for i in 1 2 3; do pnpm e2e:stack:reseed && pnpm test:e2e --project=critical; done
      // is a usable loop.
      if (!existsSync(state.env)) throw new Error(`Run local ${mode} stack up first`)
      oneShot(mode, state, 'seed')
      return
    case 'test':
      await test(mode)
      return
    case 'clean-smoke':
      await cleanSmoke(mode)
      return
    case 'scale':
      await scale(mode)
      return
    case 'faults':
      await faults(mode)
      return
    case 'upgrade':
      if (!dump)
        throw new Error('upgrade requires --pre-cutover-dump=<versioned.sql|dump>')
      await upgrade(mode, resolve(ROOT, dump))
      return
    case 'acceptance':
      if (!dump)
        throw new Error('acceptance requires --pre-cutover-dump=<versioned.sql|dump>')
      await acceptance(mode, resolve(ROOT, dump))
      return
    default:
      throw new Error(
        'Usage: stack.ts <up|smoke|logs|down|test|clean-smoke|scale|faults|upgrade|acceptance> --mode=<e2e|perf|beta> [--pre-cutover-dump=<path>]',
      )
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exit(1)
})
