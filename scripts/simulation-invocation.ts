import { fileURLToPath } from 'node:url'

export type SimulationInvocation = Readonly<{
  file: string
  args: readonly string[]
  options: Readonly<{ shell: false }>
}>

export type DisposableSimulationDatabaseTarget = Readonly<{
  databaseName: string
  databaseUrl: string
  maintenanceUrl: string
}>

/**
 * Refuse to bootstrap or migrate a base database unless its name makes its
 * disposable purpose explicit. The shared localhost/denylist guard protects
 * the host; this additional check prevents an ordinary local development
 * database from being selected accidentally.
 */
export function assertDisposableSimulationBaseUrl(baseUrl: string): void {
  const parsed = new URL(baseUrl)
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('simulation database base URL must use PostgreSQL')
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1))
  const disposableName = /(?:^|[_-])(?:test|scratch|sim)(?:$|[_-])/iu
  if (!disposableName.test(databaseName)) {
    throw new Error(
      'SIMULATION_DATABASE_URL must name a disposable test, scratch, or sim database',
    )
  }
}

/**
 * Derive one exact per-run database from a PostgreSQL connection on the same
 * server. The caller still applies the repository's localhost/denylist guard
 * before opening either URL. Keeping this derivation pure makes the destructive
 * target independently reviewable and testable.
 */
export function buildDisposableSimulationDatabaseTarget(
  baseUrl: string,
  suffix: string,
): DisposableSimulationDatabaseTarget {
  if (!/^[a-f0-9]{8,32}$/u.test(suffix)) {
    throw new Error('simulation database suffix must be 8-32 lowercase hex digits')
  }
  const parsed = new URL(baseUrl)
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('simulation database base URL must use PostgreSQL')
  }

  const databaseName = `repkey_sim_${suffix}`
  const database = new URL(parsed)
  database.pathname = `/${databaseName}`
  const maintenance = new URL(parsed)
  maintenance.pathname = '/postgres'
  return Object.freeze({
    databaseName,
    databaseUrl: database.toString(),
    maintenanceUrl: maintenance.toString(),
  })
}

/** Build an argv-only invocation; database values never enter shell source text. */
export function buildSimulationInvocation(organizationId: string): SimulationInvocation {
  return Object.freeze({
    file: process.execPath,
    args: Object.freeze([
      fileURLToPath(import.meta.resolve('tsx/cli')),
      'scripts/seed.ts',
      `--org=${organizationId}`,
      '--invariants',
    ]),
    options: Object.freeze({ shell: false as const }),
  })
}
