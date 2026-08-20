// BQC-8.2 — local production-shaped staging cell: the orchestration logic
// behind scripts/perf/staging-cell.ts (`pnpm perf:cell`).
//
// A "cell" is the full local deploy shape on an isolated slice of the
// developer machine:
//   - a dedicated PostgreSQL database (default repkey_bqc8_cell) brought to
//     the deploy migration state via the ci.yml trio (ensureTestDatabase);
//   - an isolated Redis logical db (default 9) so the cell's BullMQ keys can
//     never collide with a dev:all worker on db 0;
//   - the GBP + mail sandbox stubs as their own processes (e2e fixtures,
//     reused unmodified);
//   - the PRODUCTION web build (.output/server/index.mjs) and worker build
//     (dist-worker/index.js) with NODE_ENV=production and deterministic,
//     non-placeholder secrets (the BQC-7.6 boot guard refuses the test
//     family in production — cell secrets derive from a fixed label via
//     sha256, so a restarted cell keeps decrypting a kept database);
//   - readiness gates (web /api/health/started; the worker's
//     'BullMQ worker started on default queue' log line) and a PID state
//     file so `down` tears down exactly what `up` started.
//
// Safety contract:
//   - The cell only ever creates/drops databases named repkey_bqc8* — the
//     user's `test`, `repkey_bqc05_baseline`, dev, and e2e databases are
//     unreachable by construction (assertCellDatabaseName), and the shared
//     test-environment denylist still applies on top.
//   - Preferred ports avoid the dev:all/e2e ports (3000/4100/4101); taken
//     ports are walked past and the ACTUAL ports recorded in the state file.
//   - Every effect is injected (spawn/http/pids/fs/db/sleep/clock) so the
//     orchestration contract is unit-tested hermetically; the live boot is
//     the integration smoke (reported in docs/performance/scale-harness.md).

import { createHash } from 'node:crypto'
import { validateTestDatabaseTarget } from './test-environment-lease'

// ── Constants ────────────────────────────────────────────────────────

/** The worker's boot-complete log line (src/worker/index.ts) — the readiness gate. */
export const WORKER_READY_LINE = 'BullMQ worker started on default queue'

/** Cell state file format version — bump on any shape change; parsers fail closed. */
export const CELL_STATE_VERSION = 1 as const

/** The ONLY database-name prefix the cell may create or drop. */
export const CELL_DB_PREFIX = 'repkey_bqc8'

export const CELL_DEFAULTS = {
  dbName: 'repkey_bqc8_cell',
  /** Preferred ports — deliberately clear of dev:all (3000) and e2e stubs (4100/4101). */
  ports: { web: 3100, gbpStub: 4150, mailStub: 4151 },
  /** Isolated Redis logical db (BullMQ keys never meet a dev worker on db 0). */
  redisDb: 9,
  /** Port scan window when preferred ports are taken. */
  portScanLimit: 64,
} as const

export type CellPorts = Readonly<{ web: number; gbpStub: number; mailStub: number }>

// ── Pure: names, urls, secrets, env ──────────────────────────────────

/**
 * Refuse any database name outside the cell prefix or on the shared
 * denylist. This is the guard that makes `down --drop` safe to run on a
 * machine with irreplaceable databases.
 */
export function assertCellDatabaseName(dbName: string): void {
  if (!dbName.startsWith(`${CELL_DB_PREFIX}_`) && dbName !== CELL_DB_PREFIX) {
    throw new Error(
      `refusing to touch database '${dbName}' — the cell only manages ${CELL_DB_PREFIX}_* databases`,
    )
  }
  // Shared denylist (prod/staging/beta/live + localhost) still applies.
  validateTestDatabaseTarget(`postgresql://localhost:5432/${dbName}`)
}

/** Local trust-auth URL for the cell database (OS user, like test-db-setup). */
export function buildCellDatabaseUrl(dbName: string, osUser: string): string {
  assertCellDatabaseName(dbName)
  return `postgresql://${osUser}@localhost:5432/${dbName}`
}

/** Pin a logical db index onto a base redis URL (replaces any existing path). */
export function buildCellRedisUrl(baseRedisUrl: string, db: number): string {
  if (!Number.isInteger(db) || db < 0 || db > 15) {
    throw new Error(`redis db must be an integer 0–15, got ${db}`)
  }
  const parsed = new URL(baseRedisUrl)
  parsed.pathname = `/${db}`
  return parsed.toString()
}

/** Deterministic per-field secret: sha256 over a fixed label + field name. */
export function cellSecret(field: string): string {
  return createHash('sha256').update(`repkey-bqc8-cell|${field}`).digest('hex')
}

export type CellEnvInput = Readonly<{
  databaseUrl: string
  redisUrl: string
  ports: CellPorts
  /** Seeded org admitted to the beta cohort for the reply-publication probe. */
  probeOrgId?: string
  releaseSha: string
}>

/**
 * The complete environment for every cell process (web, worker, stubs run
 * env-free). Production-shaped: NODE_ENV=production, real (deterministic,
 * never placeholder) secrets, every provider endpoint pinned at the cell
 * stubs, dotenv discovery neutralized so a developer .env cannot leak
 * overrides into the cell.
 */
export function buildCellEnv(input: CellEnvInput): Record<string, string> {
  const gbpBase = `http://localhost:${input.ports.gbpStub}`
  const mailBase = `http://localhost:${input.ports.mailStub}`
  const env: Record<string, string> = {
    NODE_ENV: 'production',
    PORT: String(input.ports.web),
    DATABASE_URL: input.databaseUrl,
    DATABASE_URL_POOLER: input.databaseUrl,
    REDIS_URL: input.redisUrl,
    // Auth/secrets — deterministic sha256 derivations (restart-stable), never
    // the test/CI placeholder family (findPlaceholderSecrets stays empty).
    BETTER_AUTH_SECRET: cellSecret('BETTER_AUTH_SECRET'),
    BETTER_AUTH_URL: `http://localhost:${input.ports.web}`,
    RESEND_API_KEY: `re_bqc8_cell_${cellSecret('RESEND_API_KEY').slice(0, 24)}`,
    ENCRYPTION_KEY: cellSecret('ENCRYPTION_KEY'),
    OAUTH_STATE_SECRET: cellSecret('OAUTH_STATE_SECRET'),
    GUEST_SESSION_SALT: cellSecret('GUEST_SESSION_SALT').slice(0, 32),
    GOOGLE_CLIENT_ID: 'bqc8-cell-google-client-id',
    GOOGLE_CLIENT_SECRET: `bqc8cell-${cellSecret('GOOGLE_CLIENT_SECRET').slice(0, 40)}`,
    // BQC-7.2 ops gate (min 32 chars).
    OPS_METRICS_TOKEN: cellSecret('OPS_METRICS_TOKEN'),
    // Deploy identity: the pack binds runs to the same sha.
    RELEASE_SHA: input.releaseSha,
    // Sandbox pins — the real adapters/clients talk to the cell stubs only.
    GBP_API_BASE_URL: gbpBase,
    GBP_REVIEWS_API_BASE_URL: gbpBase,
    GBP_NOTIFICATIONS_API_BASE_URL: gbpBase,
    GOOGLE_OAUTH_TOKEN_URL: `${gbpBase}/oauth/token`,
    GOOGLE_OAUTH_REVOKE_URL: `${gbpBase}/oauth/revoke`,
    RESEND_BASE_URL: mailBase,
    // Hermetic boot: dotenv/config inside the worker must not merge a
    // developer .env (non-existent path = silently skipped).
    DOTENV_CONFIG_PATH: '/dev/null',
    // Local cell: one trusted hop (loopback), no proxy.
    TRUSTED_PROXY_COUNT: '0',
    LOG_LEVEL: 'info',
  }
  if (input.probeOrgId) env.BETA_ALLOWLIST_ORGS = input.probeOrgId
  return env
}

// ── Pure: ports ──────────────────────────────────────────────────────

/** Walk each preferred port past taken ones; resolved ports never collide. */
export function resolvePorts(
  preferred: CellPorts,
  taken: ReadonlySet<number>,
): CellPorts {
  const assigned = new Set(taken)
  const scan = (start: number): number => {
    for (
      let candidate = start;
      candidate < start + CELL_DEFAULTS.portScanLimit;
      candidate++
    ) {
      if (!assigned.has(candidate)) {
        assigned.add(candidate)
        return candidate
      }
    }
    throw new Error(`no free port in [${start}, ${start + CELL_DEFAULTS.portScanLimit})`)
  }
  const web = scan(preferred.web)
  const gbpStub = scan(preferred.gbpStub)
  const mailStub = scan(preferred.mailStub)
  return { web, gbpStub, mailStub }
}

// ── State store ──────────────────────────────────────────────────────

export type CellState = Readonly<{
  version: typeof CELL_STATE_VERSION
  dbName: string
  databaseUrl: string
  redisUrl: string
  ports: CellPorts
  pids: Readonly<{
    web: number | null
    worker: number | null
    gbpStub: number
    mailStub: number
  }>
  startedAt: string
  releaseSha: string
  /** Seeded org admitted to the beta cohort for the reply-publication probe. */
  probeOrgId?: string
}>

export function serializeCellState(state: CellState): string {
  return `${JSON.stringify(state, null, 2)}\n`
}

export function parseCellState(json: string): CellState {
  const parsed = JSON.parse(json) as unknown
  if (typeof parsed !== 'object' || parsed == null)
    throw new Error('cell state: not an object')
  const s = parsed as Record<string, unknown>
  if (s.version !== CELL_STATE_VERSION)
    throw new Error(`cell state: unsupported version ${String(s.version)}`)
  const ports = s.ports as Record<string, unknown> | undefined
  const pids = s.pids as Record<string, unknown> | undefined
  if (
    typeof s.dbName !== 'string' ||
    typeof s.databaseUrl !== 'string' ||
    typeof s.redisUrl !== 'string' ||
    typeof s.startedAt !== 'string' ||
    typeof s.releaseSha !== 'string' ||
    typeof ports?.web !== 'number' ||
    typeof ports?.gbpStub !== 'number' ||
    typeof ports?.mailStub !== 'number' ||
    typeof pids?.gbpStub !== 'number' ||
    typeof pids?.mailStub !== 'number'
  )
    throw new Error('cell state: shape mismatch')
  return s as unknown as CellState
}

// ── Effects (all injected) ───────────────────────────────────────────

export type CellProcessKind = 'web' | 'worker' | 'gbp-stub' | 'mail-stub'

export type CellProcessSpec = Readonly<{
  kind: CellProcessKind
  command: string
  args: readonly string[]
  env: Record<string, string>
  logPath: string
}>

export type SpawnedCellProcess = Readonly<{ pid: number }>

export type CellEffects = Readonly<{
  clock: () => Date
  /** Monotonic milliseconds — readiness deadlines (performance.now in the CLI). */
  now: () => number
  sleep: (ms: number) => Promise<void>
  readState: () => CellState | null
  writeState: (state: CellState) => void
  clearState: () => void
  isPidAlive: (pid: number) => boolean
  kill: (pid: number, signal: 'SIGTERM' | 'SIGKILL' | 0) => void
  isPortListening: (port: number) => Promise<boolean>
  /** GET the URL; true on a 2xx response. */
  httpOk: (url: string) => Promise<boolean>
  /** Tail a spawned process's log file (readiness gates grep it). */
  readProcessLog: (logPath: string) => string
  spawnCellProcess: (spec: CellProcessSpec) => SpawnedCellProcess
  runCommand: (
    command: string,
    args: readonly string[],
    env: Record<string, string>,
  ) => Promise<void>
  /** True when .output/server/index.mjs + dist-worker/index.js exist. */
  artifactsExist: () => boolean
  /** Create (if missing) + migrate the cell database to the deploy state. */
  ensureDatabase: (
    databaseUrl: string,
  ) => Promise<{ created: boolean; migrated: boolean }>
  /** Drop the cell database (callers pass a guard-approved name only). */
  dropDatabase: (dbName: string) => Promise<void>
  log: (line: string) => void
}>

// ── Small effectful primitives (injected seams — unit-tested) ────────

/** SIGTERM → grace → SIGKILL, observing liveness via kill(pid, 0). */
export async function stopProcess(
  pid: number,
  deps: {
    kill: (pid: number, signal: 'SIGTERM' | 'SIGKILL' | 0) => void
    sleep: (ms: number) => Promise<void>
    graceMs?: number
  },
): Promise<'already-gone' | 'sigterm' | 'sigkill'> {
  const alive = (): boolean => {
    try {
      deps.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  if (!alive()) return 'already-gone'
  try {
    deps.kill(pid, 'SIGTERM')
  } catch {
    return 'already-gone'
  }
  const graceMs = deps.graceMs ?? 5_000
  const stepMs = 100
  for (let waited = 0; waited < graceMs; waited += stepMs) {
    if (!alive()) return 'sigterm'
    await deps.sleep(stepMs)
  }
  try {
    deps.kill(pid, 'SIGKILL')
  } catch {
    return 'sigterm' // exited between the grace poll and the kill
  }
  return 'sigkill'
}

/** Bounded poll until `check` is true. Throws a named timeout error. */
export async function waitFor(deps: {
  what: string
  timeoutMs: number
  intervalMs: number
  check: () => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  now?: () => number
}): Promise<void> {
  const now = deps.now ?? (() => Date.now())
  const deadline = now() + deps.timeoutMs
  for (;;) {
    if (await deps.check()) return
    if (now() >= deadline) {
      throw new Error(`${deps.what} timed out after ${deps.timeoutMs}ms`)
    }
    await deps.sleep(deps.intervalMs)
  }
}

// ── Orchestration ────────────────────────────────────────────────────

export type UpCellOptions = Readonly<{
  dbName?: string
  skipBuild?: boolean
  releaseSha: string
  probeOrgId?: string
  /** Admin user for the local pg (defaults applied by the CLI). */
  databaseUrl?: string
  redisUrl?: string
}>

export type UpCellResult = Readonly<{
  reused: boolean
  state: CellState
}>

const WEB_READY_TIMEOUT_MS = 90_000
const STUB_READY_TIMEOUT_MS = 30_000
const WORKER_READY_TIMEOUT_MS = 120_000

/** True when the recorded cell is fully alive and the web answers readiness. */
async function cellHealthy(effects: CellEffects, state: CellState): Promise<boolean> {
  const pids = [state.pids.gbpStub, state.pids.mailStub]
  if (state.pids.web != null) pids.push(state.pids.web)
  if (state.pids.worker != null) pids.push(state.pids.worker)
  if (!pids.every((pid) => effects.isPidAlive(pid))) return false
  return effects.httpOk(`http://localhost:${state.ports.web}/api/health/started`)
}

export async function upCell(
  effects: CellEffects,
  options: UpCellOptions,
): Promise<UpCellResult> {
  const dbName = options.dbName ?? CELL_DEFAULTS.dbName
  assertCellDatabaseName(dbName)

  // 1. Idempotent reuse: a healthy recorded cell wins over a fresh boot.
  const existing = effects.readState()
  if (existing && (await cellHealthy(effects, existing))) {
    effects.log(`cell already running (web :${existing.ports.web}) — reusing`)
    return { reused: true, state: existing }
  }
  if (existing) {
    effects.log('stale cell state found — tearing down before re-boot')
    await downCell(effects, {})
  }

  // 2. Infrastructure: urls, ports, database, build.
  const databaseUrl =
    options.databaseUrl ?? buildCellDatabaseUrl(dbName, process.env.USER ?? 'postgres')
  const redisUrl =
    options.redisUrl ?? buildCellRedisUrl('redis://localhost:6379', CELL_DEFAULTS.redisDb)
  const taken = new Set<number>()
  for (const preferred of Object.values(CELL_DEFAULTS.ports)) {
    for (let p = preferred; p < preferred + CELL_DEFAULTS.portScanLimit; p++) {
      if (await effects.isPortListening(p)) taken.add(p)
    }
  }
  const ports = resolvePorts(CELL_DEFAULTS.ports, taken)
  if (ports.web !== CELL_DEFAULTS.ports.web) {
    effects.log(
      `preferred web port ${CELL_DEFAULTS.ports.web} taken — using ${ports.web}`,
    )
  }

  const db = await effects.ensureDatabase(databaseUrl)
  effects.log(
    `database ${dbName}: ${db.created ? 'created' : 'reused'}, ${db.migrated ? 'migrated' : 'already at deploy state'}`,
  )

  if (!options.skipBuild || !effects.artifactsExist()) {
    effects.log('building web + worker artifacts (NODE_ENV=production)…')
    await effects.runCommand('pnpm', ['build'], { NODE_ENV: 'production' })
    await effects.runCommand('pnpm', ['build:worker'], { NODE_ENV: 'production' })
  }

  const env = buildCellEnv({
    databaseUrl,
    redisUrl,
    ports,
    probeOrgId: options.probeOrgId,
    releaseSha: options.releaseSha,
  })

  // 3. Sandbox stubs first — web/worker readiness may call them. A failed
  // boot must not leak processes: everything spawned so far is stopped.
  const spawned: Array<{ pid: number }> = []
  try {
    const gbpStub = effects.spawnCellProcess({
      kind: 'gbp-stub',
      command: 'pnpm',
      args: [
        'tsx',
        'scripts/perf/cell-stub-server.ts',
        `--kind=gbp`,
        `--port=${ports.gbpStub}`,
      ],
      env,
      logPath: 'test-results/perf-cell/gbp-stub.log',
    })
    spawned.push(gbpStub)
    const mailStub = effects.spawnCellProcess({
      kind: 'mail-stub',
      command: 'pnpm',
      args: [
        'tsx',
        'scripts/perf/cell-stub-server.ts',
        `--kind=mail`,
        `--port=${ports.mailStub}`,
      ],
      env,
      logPath: 'test-results/perf-cell/mail-stub.log',
    })
    spawned.push(mailStub)
    await waitFor({
      what: 'GBP stub health',
      timeoutMs: STUB_READY_TIMEOUT_MS,
      intervalMs: 250,
      sleep: effects.sleep,
      now: effects.now,
      check: () => effects.httpOk(`http://localhost:${ports.gbpStub}/__control/health`),
    })
    await waitFor({
      what: 'mail stub health',
      timeoutMs: STUB_READY_TIMEOUT_MS,
      intervalMs: 250,
      sleep: effects.sleep,
      now: effects.now,
      check: () => effects.httpOk(`http://localhost:${ports.mailStub}/__control/health`),
    })

    // 4. Web (production build) → readiness gate.
    const web = effects.spawnCellProcess({
      kind: 'web',
      command: 'node',
      args: ['.output/server/index.mjs'],
      env,
      logPath: 'test-results/perf-cell/web.log',
    })
    spawned.push(web)
    await waitFor({
      what: 'web /api/health/started',
      timeoutMs: WEB_READY_TIMEOUT_MS,
      intervalMs: 500,
      sleep: effects.sleep,
      now: effects.now,
      check: () => effects.httpOk(`http://localhost:${ports.web}/api/health/started`),
    })

    // 5. Worker (production build) → ready log line.
    const workerLogPath = 'test-results/perf-cell/worker.log'
    const worker = effects.spawnCellProcess({
      kind: 'worker',
      command: 'node',
      args: ['dist-worker/index.js'],
      env,
      logPath: workerLogPath,
    })
    spawned.push(worker)
    await waitFor({
      what: `worker readiness ("${WORKER_READY_LINE}")`,
      timeoutMs: WORKER_READY_TIMEOUT_MS,
      intervalMs: 500,
      sleep: effects.sleep,
      now: effects.now,
      check: async () =>
        effects.readProcessLog(workerLogPath).includes(WORKER_READY_LINE),
    })

    const state: CellState = {
      version: CELL_STATE_VERSION,
      dbName,
      databaseUrl,
      redisUrl,
      ports,
      pids: {
        web: web.pid,
        worker: worker.pid,
        gbpStub: gbpStub.pid,
        mailStub: mailStub.pid,
      },
      startedAt: effects.clock().toISOString(),
      releaseSha: options.releaseSha,
      ...(options.probeOrgId ? { probeOrgId: options.probeOrgId } : {}),
    }
    effects.writeState(state)
    effects.log(
      `cell up: web :${ports.web} (pid ${web.pid}), worker pid ${worker.pid}, stubs :${ports.gbpStub}/:${ports.mailStub}, db ${dbName}, redis db ${CELL_DEFAULTS.redisDb}`,
    )
    return { reused: false, state }
  } catch (err) {
    // Boot failed partway — stop exactly what was spawned (newest first).
    for (const handle of [...spawned].reverse()) {
      await stopProcess(handle.pid, { kill: effects.kill, sleep: effects.sleep })
    }
    throw err
  }
}

export type DownCellResult = Readonly<{
  stopped: readonly number[]
  dropped: string | null
}>

export async function downCell(
  effects: CellEffects,
  options: { drop?: boolean },
): Promise<DownCellResult> {
  const state = effects.readState()
  if (!state) return { stopped: [], dropped: null }

  const stopped: number[] = []
  // Worker first (let in-flight jobs drain), then web, then stubs.
  const ordered: Array<number | null> = [
    state.pids.worker,
    state.pids.web,
    state.pids.gbpStub,
    state.pids.mailStub,
  ]
  for (const pid of ordered) {
    if (pid == null) continue
    const how = await stopProcess(pid, {
      kill: effects.kill,
      sleep: effects.sleep,
    })
    if (how !== 'already-gone') stopped.push(pid)
    effects.log(`pid ${pid}: ${how}`)
  }
  effects.clearState()

  let dropped: string | null = null
  if (options.drop) {
    assertCellDatabaseName(state.dbName)
    await effects.dropDatabase(state.dbName)
    dropped = state.dbName
    effects.log(`dropped database ${state.dbName}`)
  } else {
    effects.log(`database ${state.dbName} kept (down --drop to remove)`)
  }
  return { stopped, dropped }
}

export type CellStatus = Readonly<{
  running: boolean
  state: CellState | null
  processes: ReadonlyArray<Readonly<{ kind: string; pid: number | null; alive: boolean }>>
}>

export async function statusCell(effects: CellEffects): Promise<CellStatus> {
  const state = effects.readState()
  if (!state) return { running: false, state: null, processes: [] }
  const processes = [
    { kind: 'web', pid: state.pids.web },
    { kind: 'worker', pid: state.pids.worker },
    { kind: 'gbp-stub', pid: state.pids.gbpStub },
    { kind: 'mail-stub', pid: state.pids.mailStub },
  ].map((p) => ({ ...p, alive: p.pid != null && effects.isPidAlive(p.pid) }))
  const running = processes.every((p) => p.alive)
  return { running, state, processes }
}
