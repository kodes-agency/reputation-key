// BQC-8.2: local production-shaped staging cell (scripts/perf/staging-cell.ts).
//
// Thin wiring over src/shared/testing/staging-cell.ts (all logic + unit tests
// live there; scripts/ sits outside tsconfig/eslint per the ops precedent).
//
//   pnpm perf:cell -- up [--skip-build] [--keep-db] [--probe-org=<orgId>]
//   pnpm perf:cell -- down [--drop]
//   pnpm perf:cell -- status
//   pnpm perf:cell -- env          — print export lines for perf:run/perf:seed-scale
//
// The cell: dedicated repkey_bqc8_cell database (ci.yml migration trio),
// isolated redis logical db 9, GBP + mail sandbox stubs, production web +
// worker builds with deterministic non-placeholder secrets, readiness gates,
// PID state file (test-results/perf-cell/cell-state.json). It never touches
// the user's `test`/`repkey_bqc05_baseline`/dev databases or ports
// 3000/4100/4101 (alternates are walked to and recorded).

import { spawn } from 'node:child_process'
import { execSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  rmSync,
  closeSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createConnection } from 'node:net'
import { userInfo } from 'node:os'
import { Pool } from 'pg'
import {
  upCell,
  downCell,
  statusCell,
  buildCellEnv,
  parseCellState,
  serializeCellState,
  CELL_DEFAULTS,
  type CellEffects,
  type CellState,
} from '../../src/shared/testing/staging-cell'
import { ensureTestDatabase } from '../../src/shared/testing/test-db-setup'

const STATE_PATH = resolve(process.cwd(), 'test-results/perf-cell/cell-state.json')
const LOG_DIR = dirname(STATE_PATH)

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`))
  return hit?.slice(flag.length + 1)
}

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolvePromise(true)
    })
    socket.once('error', () => resolvePromise(false))
    socket.setTimeout(1000, () => {
      socket.destroy()
      resolvePromise(false)
    })
  })
}

async function httpOk(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
    return response.ok
  } catch {
    return false
  }
}

function realEffects(): CellEffects {
  return {
    clock: () => new Date(),
    now: () => performance.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    readState: () => {
      if (!existsSync(STATE_PATH)) return null
      try {
        return parseCellState(readFileSync(STATE_PATH, 'utf8'))
      } catch (err) {
        console.error(
          `cell state file unreadable (${err instanceof Error ? err.message : String(err)}) — treating as absent`,
        )
        return null
      }
    },
    writeState: (state: CellState) => {
      mkdirSync(LOG_DIR, { recursive: true })
      writeFileSync(STATE_PATH, serializeCellState(state), 'utf8')
    },
    clearState: () => {
      rmSync(STATE_PATH, { force: true })
    },
    isPidAlive: (pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    },
    kill: (pid, signal) => {
      process.kill(pid, signal)
    },
    isPortListening,
    httpOk,
    readProcessLog: (logPath) => {
      const path = resolve(process.cwd(), logPath)
      return existsSync(path) ? readFileSync(path, 'utf8') : ''
    },
    spawnCellProcess: (spec) => {
      mkdirSync(LOG_DIR, { recursive: true })
      const logPath = resolve(process.cwd(), spec.logPath)
      const fd = openSync(logPath, 'a')
      const child = spawn(spec.command, [...spec.args], {
        cwd: process.cwd(),
        // Minimal base + the cell env — a developer's exported DATABASE_URL
        // or .env must never steer a cell process.
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          ...spec.env,
        },
        stdio: ['ignore', fd, fd],
        detached: true,
      })
      closeSync(fd)
      child.unref()
      if (!child.pid) throw new Error(`failed to spawn ${spec.kind}`)
      console.log(`  spawned ${spec.kind} (pid ${child.pid}) → ${spec.logPath}`)
      return { pid: child.pid }
    },
    runCommand: async (command, args, env) => {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(command, [...args], {
          cwd: process.cwd(),
          env: { ...process.env, ...env },
          stdio: 'inherit',
        })
        child.on('error', rejectPromise)
        child.on('exit', (code) =>
          code === 0
            ? resolvePromise()
            : rejectPromise(new Error(`${command} ${args.join(' ')} exited ${code}`)),
        )
      })
    },
    artifactsExist: () =>
      existsSync(resolve(process.cwd(), '.output/server/index.mjs')) &&
      existsSync(resolve(process.cwd(), 'dist-worker/index.js')),
    ensureDatabase: async (databaseUrl) => {
      const result = await ensureTestDatabase(databaseUrl)
      return { created: result.created, migrated: result.migrated }
    },
    dropDatabase: async (dbName) => {
      const admin = new Pool({
        connectionString: `postgresql://${userInfo().username}@localhost:5432/postgres`,
        max: 2,
      })
      try {
        await admin.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [dbName],
        )
        await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`)
      } finally {
        await admin.end()
      }
    },
    log: (line) => console.log(`  ${line}`),
  }
}

async function cmdUp(): Promise<number> {
  const effects = realEffects()
  const releaseSha = argValue('--release-sha') ?? gitSha()
  const probeOrgId = argValue('--probe-org')
  const databaseUrl = `postgresql://${userInfo().username}@localhost:5432/${argValue('--db-name') ?? CELL_DEFAULTS.dbName}`
  const result = await upCell(effects, {
    dbName: argValue('--db-name'),
    skipBuild: process.argv.includes('--skip-build'),
    releaseSha,
    probeOrgId,
    databaseUrl,
    cacheRedisUrl: argValue('--cache-redis-url'),
    redisUrl: argValue('--queue-redis-url'),
  })
  const { state } = result
  console.log('─'.repeat(60))
  console.log(result.reused ? 'CELL REUSED (healthy)' : 'CELL UP')
  console.log(`  web:     http://localhost:${state.ports.web} (pid ${state.pids.web})`)
  console.log(`  worker:  pid ${state.pids.worker}`)
  console.log(`  stubs:   gbp :${state.ports.gbpStub} · mail :${state.ports.mailStub}`)
  console.log(`  db:      ${state.dbName}`)
  console.log(`  cache:   ${state.cacheRedisUrl}`)
  console.log(`  queue:   ${state.redisUrl}`)
  console.log(`  release: ${state.releaseSha.slice(0, 12)}`)
  console.log(`  state:   ${STATE_PATH}`)
  console.log(
    '\nNext: pnpm perf:cell -- env   (export lines for perf:run / perf:seed-scale)',
  )
  return 0
}

async function cmdDown(): Promise<number> {
  const effects = realEffects()
  const result = await downCell(effects, { drop: process.argv.includes('--drop') })
  if (result.stopped.length === 0 && !result.dropped) {
    console.log('No cell state — nothing to stop.')
    return 0
  }
  console.log(
    `CELL DOWN — stopped pids [${result.stopped.join(', ')}]` +
      (result.dropped ? `, dropped ${result.dropped}` : ', database kept'),
  )
  return 0
}

async function cmdStatus(): Promise<number> {
  const status = await statusCell(realEffects())
  if (!status.state) {
    console.log('No cell state — cell is down.')
    return 0
  }
  console.log(
    `cell ${status.running ? 'RUNNING' : 'DEGRADED'} (since ${status.state.startedAt})`,
  )
  for (const p of status.processes) {
    console.log(
      `  ${p.kind.padEnd(10)} pid ${p.pid ?? '—'} ${p.alive ? 'alive' : 'DEAD'}`,
    )
  }
  console.log(
    `  db: ${status.state.dbName} · web: http://localhost:${status.state.ports.web}`,
  )
  return status.running ? 0 : 1
}

/** Export lines so `eval "$(pnpm perf:cell -- env)"` arms perf:run/seed-scale. */
async function cmdEnv(): Promise<number> {
  const status = await statusCell(realEffects())
  if (!status.state) {
    console.error('No cell state — run `pnpm perf:cell -- up` first.')
    return 1
  }
  const { state } = status
  const env = buildCellEnv({
    databaseUrl: state.databaseUrl,
    cacheRedisUrl: state.cacheRedisUrl,
    redisUrl: state.redisUrl,
    ports: state.ports,
    probeOrgId: state.probeOrgId,
    releaseSha: state.releaseSha,
  })
  for (const [key, value] of Object.entries(env)) {
    console.log(`export ${key}='${value}'`)
  }
  console.log(`# base-url for perf:run monitoring: http://localhost:${state.ports.web}`)
  return 0
}

async function main(): Promise<number> {
  // pnpm forwards the literal `--` separator into argv — drop it so `up` is argv[2].
  if (process.argv[2] === '--') process.argv.splice(2, 1)
  const command = process.argv[2]
  switch (command) {
    case 'up':
      return cmdUp()
    case 'down':
      return cmdDown()
    case 'status':
      return cmdStatus()
    case 'env':
      return cmdEnv()
    default:
      console.error(
        'Usage: pnpm perf:cell -- up [--skip-build] [--keep-db] [--probe-org=<id>] | down [--drop] | status | env',
      )
      return 2
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('perf:cell failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
