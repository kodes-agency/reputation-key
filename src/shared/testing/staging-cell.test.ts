// BQC-8.2 — unit tests for the local production-shaped staging cell.
//
// Hermetic: every effect (spawn, http, ports, pids, fs state, db admin,
// build/migrate commands, sleep/clock) is injected — these tests pin the
// orchestration contract (env assembly, port conflict resolution, idempotent
// up, teardown escalation, protected-database guard, state store). The live
// cell boot is the integration smoke (docs/performance/scale-harness.md).

import { describe, it, expect } from 'vitest'
import { findPlaceholderSecrets } from '#/shared/config/production-secrets'
import { TestEnvironmentError } from '#/shared/testing/test-environment-lease'
import {
  CELL_DEFAULTS,
  CELL_DB_PREFIX,
  CELL_STATE_VERSION,
  assertCellDatabaseName,
  buildCellDatabaseUrl,
  buildCellRedisUrl,
  buildCellEnv,
  cellSecret,
  resolvePorts,
  serializeCellState,
  parseCellState,
  stopProcess,
  waitFor,
  upCell,
  downCell,
  statusCell,
  WORKER_READY_LINE,
  type CellEffects,
  type CellState,
  type SpawnedCellProcess,
} from './staging-cell'

const T0 = 1_752_435_200_000

const PORTS = { web: 3100, gbpStub: 4150, mailStub: 4151 }
const DB_URL = buildCellDatabaseUrl('repkey_bqc8_cell', 'bozhidardenev')
const REDIS_URL = buildCellRedisUrl('redis://localhost:6379', CELL_DEFAULTS.redisDb)

// ── pure: database name guard ────────────────────────────────────────

describe('assertCellDatabaseName', () => {
  it('accepts the default cell database and prefix-matching variants', () => {
    expect(() => assertCellDatabaseName('repkey_bqc8_cell')).not.toThrow()
    expect(() => assertCellDatabaseName('repkey_bqc8_scratch2')).not.toThrow()
  })

  it('refuses every non-cell database the user may have', () => {
    for (const name of [
      'test',
      'repkey_bqc05_baseline',
      'repkey_dev',
      'repkey_bqc65_e2e',
      'postgres',
      'template0',
      'bozhidardenev',
      'repkey_bqc9_other',
    ]) {
      expect(() => assertCellDatabaseName(name)).toThrow(/refusing/i)
    }
  })

  it('refuses names hitting the shared denylist even inside the prefix', () => {
    expect(() => assertCellDatabaseName(`repkey_bqc8_beta_copy`)).toThrow(
      TestEnvironmentError,
    )
    expect(() => assertCellDatabaseName(`${CELL_DB_PREFIX}_prod`)).toThrow(
      TestEnvironmentError,
    )
  })
})

// ── pure: env assembly ───────────────────────────────────────────────

describe('buildCellEnv', () => {
  const env = buildCellEnv({
    databaseUrl: DB_URL,
    redisUrl: REDIS_URL,
    ports: PORTS,
    probeOrgId: 'perf-org-abcd1234-0',
    releaseSha: 'deadbeef'.repeat(8),
  })

  it('is production-shaped with the cell database and the isolated redis db', () => {
    expect(env.NODE_ENV).toBe('production')
    expect(env.DATABASE_URL).toBe(DB_URL)
    expect(env.DATABASE_URL_POOLER).toBe(DB_URL)
    expect(env.REDIS_URL).toBe('redis://localhost:6379/9')
    expect(env.PORT).toBe('3100')
    expect(env.RELEASE_SHA).toBe('deadbeef'.repeat(8))
  })

  it('pins every Google/Resend endpoint at the cell stubs (no real provider)', () => {
    expect(env.GBP_API_BASE_URL).toBe('http://localhost:4150')
    expect(env.GBP_REVIEWS_API_BASE_URL).toBe('http://localhost:4150')
    expect(env.GBP_NOTIFICATIONS_API_BASE_URL).toBe('http://localhost:4150')
    expect(env.GOOGLE_OAUTH_TOKEN_URL).toBe('http://localhost:4150/oauth/token')
    expect(env.GOOGLE_OAUTH_REVOKE_URL).toBe('http://localhost:4150/oauth/revoke')
    expect(env.RESEND_BASE_URL).toBe('http://localhost:4151')
  })

  it('carries a 32+ char ops token and the probe-org allowlist', () => {
    expect(env.OPS_METRICS_TOKEN.length).toBeGreaterThanOrEqual(32)
    expect(env.BETA_ALLOWLIST_ORGS).toBe('perf-org-abcd1234-0')
  })

  it('neutralizes dotenv discovery so a developer .env cannot leak in', () => {
    expect(env.DOTENV_CONFIG_PATH).toBe('/dev/null')
  })

  it('never emits placeholder secrets (the BQC-7.6 production boot guard)', () => {
    expect(findPlaceholderSecrets(env)).toEqual([])
  })

  it('derives secrets deterministically (restart-stable for a kept DB)', () => {
    const again = buildCellEnv({
      databaseUrl: DB_URL,
      redisUrl: REDIS_URL,
      ports: PORTS,
      probeOrgId: 'perf-org-abcd1234-0',
      releaseSha: 'deadbeef'.repeat(8),
    })
    expect(again.ENCRYPTION_KEY).toBe(env.ENCRYPTION_KEY)
    expect(again.BETTER_AUTH_SECRET).toBe(env.BETTER_AUTH_SECRET)
    expect(env.ENCRYPTION_KEY).toMatch(/^[a-f0-9]{64}$/)
    expect(cellSecret('ENCRYPTION_KEY')).toBe(env.ENCRYPTION_KEY)
  })

  it('omits the allowlist when no probe org is given', () => {
    const noProbe = buildCellEnv({
      databaseUrl: DB_URL,
      redisUrl: REDIS_URL,
      ports: PORTS,
      releaseSha: 'deadbeef'.repeat(8),
    })
    expect(noProbe.BETA_ALLOWLIST_ORGS).toBeUndefined()
  })
})

// ── pure: port conflict resolution ───────────────────────────────────

describe('resolvePorts', () => {
  it('keeps the preferred ports when free', () => {
    expect(resolvePorts(PORTS, new Set())).toEqual(PORTS)
  })

  it('walks past conflicts (dev:all on 3000/4100/4101, another cell, …)', () => {
    const taken = new Set([3100, 4150])
    expect(resolvePorts(PORTS, taken)).toEqual({
      web: 3101,
      gbpStub: 4151,
      mailStub: 4151 + 1,
    })
  })

  it('fails closed when the whole scan window is taken', () => {
    const taken = new Set(Array.from({ length: 64 }, (_, i) => 3100 + i))
    expect(() => resolvePorts(PORTS, taken)).toThrow(/no free port/i)
  })
})

// ── state store contract ─────────────────────────────────────────────

function sampleState(): CellState {
  return {
    version: CELL_STATE_VERSION,
    dbName: 'repkey_bqc8_cell',
    databaseUrl: DB_URL,
    redisUrl: REDIS_URL,
    ports: PORTS,
    pids: { web: 111, worker: 222, gbpStub: 333, mailStub: 444 },
    startedAt: new Date(T0).toISOString(),
    releaseSha: 'deadbeef'.repeat(8),
  }
}

describe('cell state store', () => {
  it('round-trips', () => {
    expect(parseCellState(serializeCellState(sampleState()))).toEqual(sampleState())
  })

  it('fails closed on version/shape drift', () => {
    expect(() => parseCellState('{"version":99}')).toThrow(/version/)
    expect(() => parseCellState('{"version":1}')).toThrow(/shape/)
    expect(() => parseCellState('not json')).toThrow(SyntaxError)
  })
})

// ── stopProcess escalation ───────────────────────────────────────────

describe('stopProcess', () => {
  function fakeKill(alive: Set<number>) {
    const signals: Array<{ pid: number; signal: string }> = []
    return {
      signals,
      kill: (pid: number, signal: 'SIGTERM' | 'SIGKILL' | 0) => {
        if (signal === 0) {
          if (!alive.has(pid)) throw new Error('ESRCH')
          return
        }
        signals.push({ pid, signal })
        if (signal === 'SIGTERM') alive.delete(pid)
        if (signal === 'SIGKILL') alive.delete(pid)
      },
    }
  }

  it('is a no-op when the pid is already gone', async () => {
    const alive = new Set<number>()
    const { kill, signals } = fakeKill(alive)
    const result = await stopProcess(42, { kill, sleep: async () => {}, graceMs: 50 })
    expect(result).toBe('already-gone')
    expect(signals).toEqual([])
  })

  it('SIGTERMs and observes the exit within the grace window', async () => {
    const alive = new Set([7])
    const { kill, signals } = fakeKill(alive)
    const result = await stopProcess(7, { kill, sleep: async () => {}, graceMs: 50 })
    expect(result).toBe('sigterm')
    expect(signals).toEqual([{ pid: 7, signal: 'SIGTERM' }])
  })

  it('escalates to SIGKILL when the process ignores SIGTERM', async () => {
    const alive = new Set([9])
    const signals: Array<{ pid: number; signal: string }> = []
    const kill = (pid: number, signal: 'SIGTERM' | 'SIGKILL' | 0) => {
      if (signal === 0) {
        if (!alive.has(pid)) throw new Error('ESRCH')
        return
      }
      signals.push({ pid, signal })
      if (signal === 'SIGKILL') alive.delete(pid) // SIGTERM ignored on purpose
    }
    const result = await stopProcess(9, { kill, sleep: async () => {}, graceMs: 30 })
    expect(result).toBe('sigkill')
    expect(signals).toEqual([
      { pid: 9, signal: 'SIGTERM' },
      { pid: 9, signal: 'SIGKILL' },
    ])
  })
})

// ── waitFor ──────────────────────────────────────────────────────────

describe('waitFor', () => {
  it('resolves when the predicate turns true', async () => {
    let ticks = 0
    let slept = 0
    await waitFor({
      what: 'test condition',
      timeoutMs: 1000,
      intervalMs: 100,
      sleep: async (ms) => {
        slept += ms
      },
      check: async () => ++ticks >= 3,
    })
    expect(ticks).toBe(3)
    expect(slept).toBe(200)
  })

  it('times out with a named error', async () => {
    let now = 0
    await expect(
      waitFor({
        what: 'never-true',
        timeoutMs: 250,
        intervalMs: 100,
        now: () => now,
        sleep: async (ms) => {
          now += ms
        },
        check: async () => false,
      }),
    ).rejects.toThrow(/never-true.*timed out/i)
  })
})

// ── orchestration (up/down/status) with fake effects ─────────────────

type FakeRig = {
  effects: CellEffects
  spawned: Array<{ kind: string; pid: number }>
  commands: string[]
  dropped: string[]
  ensured: string[]
  alive: Set<number>
  state: CellState | null
  logs: Map<string, string>
  health: Map<string, boolean>
}

function fakeRig(
  opts: {
    portsTaken?: Set<number>
    state?: CellState | null
    artifactsExist?: boolean
    webNeverReady?: boolean
  } = {},
): FakeRig {
  const alive = new Set<number>()
  const logs = new Map<string, string>()
  const health = new Map<string, boolean>()
  const rig: FakeRig = {
    spawned: [],
    commands: [],
    dropped: [],
    ensured: [],
    alive,
    state: opts.state ?? null,
    logs,
    health,
    effects: undefined as unknown as CellEffects,
  }
  let nextPid = 1000
  let now = 0
  const spawn = (kind: string, logPath: string): SpawnedCellProcess => {
    const pid = nextPid++
    alive.add(pid)
    rig.spawned.push({ kind, pid })
    // The worker process reports readiness through its log line.
    if (kind === 'worker') logs.set(logPath, `boot\n${WORKER_READY_LINE}\n`)
    return { pid }
  }
  rig.effects = {
    clock: () => new Date(T0),
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
    readState: () => rig.state,
    writeState: (s) => {
      rig.state = s
    },
    clearState: () => {
      rig.state = null
    },
    isPidAlive: (pid) => alive.has(pid),
    kill: (pid, signal) => {
      if (signal === 0) {
        if (!alive.has(pid)) throw new Error('ESRCH')
        return
      }
      alive.delete(pid)
    },
    isPortListening: async (port) => opts.portsTaken?.has(port) ?? false,
    httpOk: async (url) =>
      opts.webNeverReady === true ? !url.includes('/api/health/started') : true,
    readProcessLog: (logPath) => logs.get(logPath) ?? '',
    spawnCellProcess: (spec) => spawn(spec.kind, spec.logPath),
    runCommand: async (cmd, args) => {
      rig.commands.push([cmd, ...args].join(' '))
    },
    artifactsExist: () => opts.artifactsExist ?? true,
    ensureDatabase: async (url) => {
      rig.ensured.push(url)
      return { created: true, migrated: true }
    },
    dropDatabase: async (name) => {
      rig.dropped.push(name)
    },
    log: () => {},
  }
  return rig
}

describe('upCell', () => {
  it('boots db → stubs → web → worker, records the state, and is quiet on rebuild', async () => {
    const rig = fakeRig()
    const result = await upCell(rig.effects, {
      dbName: 'repkey_bqc8_cell',
      databaseUrl: DB_URL, // pinned — the default derives from the ambient OS user
      skipBuild: true,
      releaseSha: 'deadbeef'.repeat(8),
    })
    expect(result.reused).toBe(false)
    expect(rig.ensured).toEqual([DB_URL])
    expect(rig.commands).toEqual([]) // skipBuild: no pnpm build
    expect(rig.spawned.map((s) => s.kind)).toEqual([
      'gbp-stub',
      'mail-stub',
      'web',
      'worker',
    ])
    const state = rig.state!
    expect(state.pids.web).toBe(rig.spawned[2].pid)
    expect(state.ports).toEqual(PORTS)
    expect(state.dbName).toBe('repkey_bqc8_cell')
  })

  it('builds when artifacts are missing and --skip-build was not passed', async () => {
    const rig = fakeRig({ artifactsExist: false })
    await upCell(rig.effects, {
      dbName: 'repkey_bqc8_cell',
      releaseSha: 'deadbeef'.repeat(8),
    })
    expect(rig.commands).toEqual(['pnpm build', 'pnpm build:worker'])
  })

  it('reuses a healthy running cell (idempotent up)', async () => {
    const prior = fakeRig()
    const first = await upCell(prior.effects, {
      dbName: 'repkey_bqc8_cell',
      skipBuild: true,
      releaseSha: 'deadbeef'.repeat(8),
    })
    const spawns = prior.spawned.length
    const second = await upCell(prior.effects, {
      dbName: 'repkey_bqc8_cell',
      skipBuild: true,
      releaseSha: 'deadbeef'.repeat(8),
    })
    expect(second.reused).toBe(true)
    expect(second.state).toEqual(first.state)
    expect(prior.spawned.length).toBe(spawns)
  })

  it('tears down a stale (half-dead) cell before re-booting', async () => {
    const rig = fakeRig()
    await upCell(rig.effects, {
      dbName: 'repkey_bqc8_cell',
      skipBuild: true,
      releaseSha: 'deadbeef'.repeat(8),
    })
    const state = rig.state!
    // Kill the worker out from under the cell: now unhealthy.
    rig.alive.delete(state.pids.worker!)
    const spawns = rig.spawned.length
    const result = await upCell(rig.effects, {
      dbName: 'repkey_bqc8_cell',
      skipBuild: true,
      releaseSha: 'deadbeef'.repeat(8),
    })
    expect(result.reused).toBe(false)
    expect(rig.spawned.length).toBeGreaterThan(spawns)
  })

  it('records alternate ports when the preferred ones are taken', async () => {
    const rig = fakeRig({ portsTaken: new Set([3100]) })
    const result = await upCell(rig.effects, {
      dbName: 'repkey_bqc8_cell',
      skipBuild: true,
      releaseSha: 'deadbeef'.repeat(8),
    })
    expect(result.state.ports.web).toBe(3101)
  })

  it('refuses a protected database name before touching anything', async () => {
    const rig = fakeRig()
    await expect(
      upCell(rig.effects, {
        dbName: 'test',
        skipBuild: true,
        releaseSha: 'x'.repeat(64),
      }),
    ).rejects.toThrow(/refusing/i)
    expect(rig.ensured).toEqual([])
    expect(rig.spawned).toEqual([])
  })

  it('stops everything it spawned when a readiness gate fails (no leaks)', async () => {
    // The web readiness probe never turns true.
    const rig = fakeRig({ webNeverReady: true })
    await expect(
      upCell(rig.effects, {
        dbName: 'repkey_bqc8_cell',
        skipBuild: true,
        releaseSha: 'x'.repeat(64),
      }),
    ).rejects.toThrow(/timed out/i)
    expect(rig.spawned.map((s) => s.kind)).toEqual(['gbp-stub', 'mail-stub', 'web'])
    for (const s of rig.spawned) expect(rig.alive.has(s.pid)).toBe(false)
    expect(rig.state).toBeNull()
  })
})

describe('downCell', () => {
  it('stops every process, keeps the DB by default, and clears the state', async () => {
    const rig = fakeRig()
    await upCell(rig.effects, {
      dbName: 'repkey_bqc8_cell',
      skipBuild: true,
      releaseSha: 'deadbeef'.repeat(8),
    })
    const pids = Object.values(rig.state!.pids).filter((p): p is number => p != null)
    const result = await downCell(rig.effects, {})
    expect([...result.stopped].sort()).toEqual([...pids].sort())
    expect(rig.dropped).toEqual([])
    expect(rig.state).toBeNull()
    for (const pid of pids) expect(rig.alive.has(pid)).toBe(false)
  })

  it('drops the cell database only when asked (and only a cell database)', async () => {
    const rig = fakeRig()
    await upCell(rig.effects, {
      dbName: 'repkey_bqc8_cell',
      skipBuild: true,
      releaseSha: 'deadbeef'.repeat(8),
    })
    await downCell(rig.effects, { drop: true })
    expect(rig.dropped).toEqual(['repkey_bqc8_cell'])
  })

  it('is a no-op when no state exists', async () => {
    const rig = fakeRig()
    const result = await downCell(rig.effects, { drop: true })
    expect(result.stopped).toEqual([])
    expect(rig.dropped).toEqual([])
  })
})

describe('statusCell', () => {
  it('reports a healthy cell with live pids', async () => {
    const rig = fakeRig()
    await upCell(rig.effects, {
      dbName: 'repkey_bqc8_cell',
      skipBuild: true,
      releaseSha: 'deadbeef'.repeat(8),
    })
    const status = await statusCell(rig.effects)
    expect(status.running).toBe(true)
    expect(status.state?.pids.web).toBe(rig.state!.pids.web)
    expect(status.processes.every((p) => p.alive)).toBe(true)
  })

  it('reports not-running when there is no state', async () => {
    const rig = fakeRig()
    const status = await statusCell(rig.effects)
    expect(status.running).toBe(false)
    expect(status.processes).toEqual([])
  })
})
