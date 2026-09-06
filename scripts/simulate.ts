// Simulate script — creates an isolated local PostgreSQL database, applies the
// production-equivalent migration sequence, runs the simulation with invariant
// checks, then drops the database.
//
// Usage: pnpm simulate
//
// SIMULATION_DATABASE_URL may select local PostgreSQL server credentials, but
// its database name must explicitly contain test, scratch, or sim. The named
// scratch database may be bootstrapped/migrated; customer/development data is
// never copied or read. Plain DATABASE_URL is deliberately ignored.

import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { ensureTestDatabase } from '../src/shared/testing/test-db-setup'
import { DEFAULT_TEST_DATABASE_URL } from '../src/shared/testing/test-environment'
import { validateTestDatabaseTarget } from '../src/shared/testing/test-environment-lease'
import {
  assertDisposableSimulationBaseUrl,
  buildDisposableSimulationDatabaseTarget,
  buildSimulationInvocation,
  type DisposableSimulationDatabaseTarget,
} from './simulation-invocation'

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

async function createDisposableDatabase(
  target: DisposableSimulationDatabaseTarget,
): Promise<void> {
  const pool = new Pool({ connectionString: target.maintenanceUrl, max: 1 })
  try {
    await pool.query(`CREATE DATABASE ${quoteIdentifier(target.databaseName)}`)
  } finally {
    await pool.end()
  }
}

async function dropDisposableDatabase(
  target: DisposableSimulationDatabaseTarget,
): Promise<void> {
  const pool = new Pool({ connectionString: target.maintenanceUrl, max: 1 })
  try {
    await pool.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [target.databaseName],
    )
    await pool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(target.databaseName)}`)
  } finally {
    await pool.end()
  }
}

function runSimulation(connectionUrl: string, orgId: string): void {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Running simulation for org: ${orgId}`)
  console.log('─'.repeat(60))

  const invocation = buildSimulationInvocation(orgId)
  execFileSync(invocation.file, [...invocation.args], {
    ...invocation.options,
    stdio: 'inherit',
    timeout: 240000,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: connectionUrl,
      DATABASE_URL_POOLER: connectionUrl,
    },
  })
}

async function main(): Promise<void> {
  const baseUrl =
    process.env.SIMULATION_DATABASE_URL ??
    process.env.TEST_DATABASE_URL ??
    DEFAULT_TEST_DATABASE_URL
  validateTestDatabaseTarget(baseUrl)
  assertDisposableSimulationBaseUrl(baseUrl)

  // The canonical scratch database bootstrap also guarantees that its local
  // role exists and has CREATEDB before this command creates its unique child.
  await ensureTestDatabase(baseUrl)
  const suffix = randomUUID().replaceAll('-', '')
  const target = buildDisposableSimulationDatabaseTarget(baseUrl, suffix)
  validateTestDatabaseTarget(target.databaseUrl)
  let created = false

  try {
    console.log(`Creating disposable local PostgreSQL database: ${target.databaseName}`)
    await createDisposableDatabase(target)
    created = true
    await ensureTestDatabase(target.databaseUrl)
    runSimulation(target.databaseUrl, `sim-${suffix}`)
  } finally {
    if (created) {
      console.log(`\nDropping disposable database ${target.databaseName}...`)
      await dropDisposableDatabase(target)
    }
  }
}

main().catch((e) => {
  console.error('\n Simulation failed:', e)
  process.exit(1)
})
