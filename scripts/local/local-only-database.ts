// The guard of a development script that deletes rows from whatever
// DATABASE_URL names (scripts/cleanup-all.ts, scripts/cleanup-kodes.ts), and of
// the acceptance seeder, which writes its fixtures there and clears rate-limit
// keys in whatever REDIS_URL names.
//
// An operator's shell holds a deployed DATABASE_URL for `pnpm ops`, and those
// scripts used to dial it without asking. No single reading settles whether a
// database is this developer's own, so three independent ones must all agree,
// and none of them has an override:
//
//   1. the process: it is not in production mode and carries no RAILWAY_*
//      variable. Railway injects those into every deployment and into
//      `railway run` and `railway shell`, which is how a deployed service's
//      environment reaches a laptop;
//   2. the host: the driver will connect to this machine;
//   3. the database: its name says it is local or disposable. Loopback only
//      says where the connection starts (a tunnel or port-forward to a
//      deployed database ends there too), and Railway's database is named
//      `railway`.
//
// A Redis has no name to read, so assertLocalOnlyRedis holds it to the host
// alone; the seeder only gets that far where its database passed all three.
//
// A refusal names the host or the database, never the address: it holds the
// password.

import { Redis } from 'ioredis'
import { Client } from 'pg'

export type LocalDatabaseTarget = Readonly<{ host: string; database: string }>

type Environment = Readonly<Record<string, string | undefined>>

const DEPLOYED_VARIABLE_PREFIX = 'RAILWAY_'
const POSTGRES_PROTOCOLS: ReadonlySet<string> = new Set(['postgres:', 'postgresql:'])
const REDIS_PROTOCOLS: ReadonlySet<string> = new Set(['redis:', 'rediss:'])
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
])
/** A local-only database name must carry one of these words. */
const LOCAL_DATABASE_NAME = /(?:^|[_-])(?:local|dev|test|scratch|sim)(?:$|[_-])/iu

function refuse(reason: string): never {
  throw new Error(`Local-only script refused: ${reason}`)
}

function refuseDeployedProcess(env: Environment): void {
  if (env.NODE_ENV === 'production') refuse('NODE_ENV is production')
  // A blank value counts: a variable nobody can vouch for must not read as
  // "not deployed".
  const deployed = Object.keys(env).filter(
    (name) => name.startsWith(DEPLOYED_VARIABLE_PREFIX) && env[name] !== undefined,
  )
  if (deployed.length > 0) {
    refuse(`this shell carries a deployed service's environment (${deployed.join(', ')})`)
  }
}

function isPostgresAddress(databaseUrl: string): boolean {
  try {
    return POSTGRES_PROTOCOLS.has(new URL(databaseUrl).protocol)
  } catch {
    return false
  }
}

/**
 * Where the driver will connect. Asked of the driver, not read off the
 * address: `pg` takes a `host` parameter over the host written before the
 * path, so `…@localhost/db?host=elsewhere` reads as local and is not.
 * Constructing a client opens nothing.
 */
function driverTarget(databaseUrl: string | undefined): LocalDatabaseTarget {
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    refuse('DATABASE_URL is not set')
  }
  if (!isPostgresAddress(databaseUrl)) refuse('DATABASE_URL is not a PostgreSQL address')
  const client = new Client({ connectionString: databaseUrl })
  return { host: client.host, database: client.database ?? '' }
}

/** Loopback, or a Unix socket directory, which the driver takes as a host. */
function isThisMachine(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase()) || host.startsWith('/')
}

/**
 * Refuses unless every reading says the database is this developer's own.
 * Returns the target, so the script can say where it is about to write.
 */
export function assertLocalOnlyDatabase(env: Environment): LocalDatabaseTarget {
  refuseDeployedProcess(env)
  const target = driverTarget(env.DATABASE_URL)
  if (!isThisMachine(target.host)) {
    refuse(`DATABASE_URL points at host "${target.host}", not at this machine`)
  }
  if (!LOCAL_DATABASE_NAME.test(target.database)) {
    refuse(
      `database "${target.database}" does not name itself local, dev, test, scratch or sim`,
    )
  }
  return target
}

/**
 * Where the driver will connect for a Redis address, or undefined when the
 * address is not one. Constructing a client with `lazyConnect` opens nothing.
 */
function redisHost(address: string): string | undefined {
  try {
    if (!REDIS_PROTOCOLS.has(new URL(address).protocol)) return undefined
    const client = new Redis(address, { lazyConnect: true })
    const host = client.options.host
    client.disconnect()
    return host
  } catch {
    return undefined
  }
}

/**
 * Refuses a Redis that is not on this machine. Without a REDIS_URL there is no
 * Redis to check.
 */
export function assertLocalOnlyRedis(env: Environment): void {
  const address = env.REDIS_URL
  if (address === undefined || address.trim() === '') return
  const host = redisHost(address)
  if (host === undefined) refuse('REDIS_URL is not a Redis address')
  if (!isThisMachine(host)) {
    refuse(`REDIS_URL points at host "${host}", not at this machine`)
  }
}
