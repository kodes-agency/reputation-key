import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { basename, extname, resolve } from 'node:path'
import { connect } from 'node:net'
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
  { name: 'redis', service: 'redis', endpoint: 'tcp', port: 56381 },
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
  e2eArtifacts: string
  hostSeedState: string
}>

type DockerInspect = ReadonlyArray<{
  Image: string
  Config: { Image: string; User: string; Env: string[]; Labels: Record<string, string> }
  State: { Running: boolean }
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

type RunOptions = Readonly<{
  env?: NodeJS.ProcessEnv
  capture?: boolean
  allowFailure?: boolean
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
  const env = buildLocalStackEnv({
    mode,
    revision: revision(),
    artifactDir: state.artifacts,
    e2eDir: state.e2eArtifacts,
  })
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
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
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

function workerReadyCount(mode: LocalStackMode, state: StackPaths): number {
  const containerId = dockerCompose(mode, state, ['ps', '--all', '--quiet', 'worker'], {
    capture: true,
    allowFailure: true,
  }).trim()
  if (!containerId) return 0

  const startedAt = run(
    'docker',
    ['inspect', '--format', '{{.State.StartedAt}}', containerId],
    { capture: true, allowFailure: true },
  ).trim()
  const startedAtMs = Date.parse(startedAt)
  if (!Number.isFinite(startedAtMs)) return 0

  // Worker readiness is emitted once during startup. Bound log capture to that
  // window so a long-running worker cannot exhaust spawnSync's output buffer.
  const logs = run(
    'docker',
    [
      'logs',
      '--since',
      new Date(startedAtMs).toISOString(),
      '--until',
      new Date(startedAtMs + 120_000).toISOString(),
      containerId,
    ],
    { capture: true, allowFailure: true },
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

function serviceRunning(
  mode: LocalStackMode,
  state: StackPaths,
  service: string,
): boolean {
  const id = dockerCompose(mode, state, ['ps', '--all', '--quiet', service], {
    capture: true,
    allowFailure: true,
  }).trim()
  if (!id) return false
  const parsed = JSON.parse(
    run('docker', ['inspect', id], { capture: true }),
  ) as DockerInspect
  return parsed[0]?.State.Running === true
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
    if (containerEnv.get('IMAGE_SOURCE_REVISION') !== env.SOURCE_REVISION) {
      throw new Error(`${service} baked revision does not match SOURCE_REVISION`)
    }
    if (
      !service.includes('sandbox') &&
      service !== 'mail-stub' &&
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
  service: 'object-store-init' | 'migrator' | 'seed',
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
  dockerCompose(mode, state, [
    'build',
    'web',
    'worker',
    'provider-sandbox',
    'perf-runner',
  ])
}

function startDependencies(mode: LocalStackMode, state: StackPaths): void {
  dockerCompose(mode, state, [
    'up',
    '--detach',
    '--wait',
    '--wait-timeout',
    '180',
    'postgres',
    'redis',
    'object-store',
    'provider-sandbox',
    'mail-stub',
  ])
}

function sanitationEvidence(
  mode: LocalStackMode,
  state: StackPaths,
): Record<string, unknown> {
  const publicTables = Number(
    queryDb(mode, state, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public'`),
  )
  const redisKeys = Number(
    dockerCompose(mode, state, ['exec', '-T', 'redis', 'redis-cli', '--raw', 'DBSIZE'], {
      capture: true,
    }).trim(),
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
    redisKeysBeforeApplication: redisKeys,
    objectCountBeforeApplication: objectCount,
    generatedEnvironmentMode: envMode.toString(8),
    noStaleDatabase: publicTables === 0,
    noStaleRedisQueue: redisKeys === 0,
    noStaleObjects: objectCount === 0,
    protectedGeneratedSecrets: envMode === 0o600,
  }
  if (
    !evidence.noStaleDatabase ||
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

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

async function scale(mode: LocalStackMode, preserveArtifacts = false): Promise<string> {
  const { state, sanitation } = await up(mode, {
    cleanStart: true,
    preserveArtifacts,
  })
  try {
    const scaleManifest = '/artifacts/perf/scale-dataset.json'
    const runner = (args: readonly string[]) =>
      dockerCompose(mode, state, [
        'exec',
        '-T',
        'perf-runner',
        'pnpm',
        'exec',
        'tsx',
        ...args,
      ])
    runner([
      'scripts/perf/seed-scale.ts',
      '--seed=beta-local-scale-v1',
      '--orgs=100',
      '--properties=5000',
      '--reviews=500000',
      '--source-lifecycle',
      `--manifest=${scaleManifest}`,
    ])
    runner([
      'scripts/perf/seed-scale.ts',
      '--seed=beta-local-scale-v1',
      '--orgs=100',
      '--properties=5000',
      '--reviews=500000',
      '--source-lifecycle',
      `--manifest=${scaleManifest}`,
      '--verify',
    ])
    runner([
      'scripts/perf/seed-scale.ts',
      '--seed=beta-local-scale-v1',
      '--orgs=100',
      '--properties=5000',
      '--reviews=500000',
      '--source-lifecycle',
      `--manifest=${scaleManifest}`,
      '--clean',
    ])
    runner([
      'scripts/perf/seed-fleet.ts',
      '--seed=beta-local-fleet-v1',
      '--properties=5000',
      '--p1-ratio=0.5',
      '--artifact=/artifacts/perf/fleet-fixture.json',
    ])
    const scaleEvidencePath = resolve(state.artifacts, 'perf/scale-dataset.json')
    const fleetEvidencePath = resolve(state.artifacts, 'perf/fleet-fixture.json')
    const scaleEvidence = readJson(scaleEvidencePath)
    const fleetEvidence = readJson(fleetEvidencePath)
    return writeEvidence(state, 'scale', {
      schemaVersion: 'beta-local-1',
      evidenceKind: 'synthetic-local-scale-and-bounded-query',
      sourceRevision: revision(),
      sanitation,
      migrationHead: migrationHeadProof(mode, state, 'clean'),
      scaleFixture: scaleEvidence,
      scaleFixtureFileSha256: sha256(readFileSync(scaleEvidencePath)),
      fleetFixture: fleetEvidence,
      fleetFixtureFileSha256: sha256(readFileSync(fleetEvidencePath)),
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
      'pnpm',
      '--silent',
      'exec',
      'tsx',
      'scripts/local-stack/fault-operation.ts',
      dependency,
      phase,
    ],
    { capture: true },
  )
  const json = output.trim().split('\n').at(-1)
  if (!json) throw new Error(`${dependency} ${phase} probe returned no evidence`)
  return JSON.parse(json) as Record<string, unknown>
}

function enqueueReviewCreatedProbe(mode: LocalStackMode, state: StackPaths): string {
  return queryDb(
    mode,
    state,
    `WITH source AS (
       SELECT id, organization_id, property_id, external_id, platform
       FROM reviews ORDER BY created_at, id LIMIT 1
     )
     INSERT INTO outbox_events (
       event_type, event_version, payload, organization_id, property_id,
       source_context, source_aggregate_id
     )
     SELECT 'review.created', 1,
       jsonb_build_object(
         'reviewId', id, 'organizationId', organization_id,
         'propertyId', property_id, 'externalId', external_id,
         'platform', platform, 'occurredAt', now()
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

async function waitForEventDelivery(
  mode: LocalStackMode,
  state: StackPaths,
  eventId: string,
): Promise<Readonly<{ published: boolean; receipts: number }>> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const delivery = eventDelivery(mode, state, eventId)
    if (delivery.published && delivery.receipts > 0) return delivery
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
  const workerReadyBefore = workerReadyCount(mode, state)
  if (fault.name === 'worker') {
    dockerCompose(mode, state, ['stop', '--timeout', '10', 'web', 'worker'])
    const eventId = enqueueReviewCreatedProbe(mode, state)
    const queued = eventDelivery(mode, state, eventId)
    const externalAfterFailedOperation = await externalEffectCounts()
    const readinessDuringFault = await probeHttp('http://127.0.0.1:3000/api/health/ready')
    const failClosed =
      !queued.published && queued.receipts === 0 && !readinessDuringFault.reachable
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
    await waitWorker(mode, state, workerReadyBefore + 1)
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
    fault.endpoint === 'http'
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
    (fault.endpoint === 'http'
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
    const dumpSha256 = sha256(readFileSync(dumpPath))
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
    await startApplications(mode, state)
    await smoke(mode, state)
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
    stackContractSha256: sha256(readFileSync(COMPOSE_FILE)),
    scaleFixtureSha256: scaleEvidence.scaleFixtureFileSha256,
    fleetFixtureSha256: scaleEvidence.fleetFixtureFileSha256,
    images: upgraded.images,
    claims: ['local-application', 'local-image', 'local-topology'],
    exclusions: ['pitr', 'hosted-capacity', 'managed-region-failover', 'pilot'],
  })
  rmSync(state.env, { force: true })
}

async function main(): Promise<void> {
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
