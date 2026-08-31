// ConfiguredDatabaseFence — refuses to let any test run, lease, or migration
// setup target the database a developer has configured for ordinary
// development.
//
// Why this exists: on 2026-08-28 two overly broad test invocations reached
// migration setup against the configured default development database. Better
// Auth reported no change and Drizzle then halted on an already-existing
// column, leaving that database with a migration ledger that no commit
// describes (see docs/operations/development-database-drift-diagnosis-2026-08-28.md).
// The existing lease guard did not catch it: the target was localhost and its
// name matched no production-like denylist pattern. Invocation discipline is
// not a control; this is.
//
// Reading .env here does NOT contradict the "test runners never load .env"
// rule in test-environment.ts. That rule stops developer configuration from
// *supplying* values to a test run. This module uses the same files only as a
// **refusal set** — the values are never injected anywhere, only compared and
// rejected. Nothing here returns a connection string to a caller.
//
// There is deliberately no environment-variable escape hatch. A developer
// database is never a legitimate test target: program verification runs on a
// database created from scratch and migrated through the whole journal.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_TEST_DATABASE_URL } from './test-environment'
import { TestEnvironmentError } from './test-environment-error'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** Developer files that may carry a connection string, in precedence order. */
export const CONFIGURED_DATABASE_ENV_FILES = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
] as const

/** Every connection variable the runtime honours; all of them must be fenced. */
export const CONFIGURED_DATABASE_ENV_KEYS = [
  'DATABASE_URL',
  'DATABASE_URL_POOLER',
  'DIRECT_DATABASE_URL',
] as const

/** Host spellings that reach the same local PostgreSQL server. */
const LOCALHOST_ALIASES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', ''])

export type DatabaseIdentity = Readonly<{
  host: string
  port: string
  database: string
}>

/**
 * The host/port/database a URL addresses, with credentials and query
 * parameters discarded. Returns null when the value is not a URL at all, so a
 * malformed developer file can never crash a test run.
 */
export function databaseIdentity(url: string): DatabaseIdentity | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (database === '') return null
  return {
    host: parsed.hostname.toLowerCase(),
    port: parsed.port === '' ? '5432' : parsed.port,
    database,
  }
}

function canonicalHost(host: string): string {
  return LOCALHOST_ALIASES.has(host) ? 'localhost' : host
}

/** Whether two identities address the same database, allowing localhost aliases. */
export function sameDatabaseIdentity(
  left: DatabaseIdentity,
  right: DatabaseIdentity,
): boolean {
  return (
    canonicalHost(left.host) === canonicalHost(right.host) &&
    left.port === right.port &&
    left.database === right.database
  )
}

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/

function unquote(raw: string): string {
  const value = raw.trim()
  const quoted = /^(['"])(.*)\1$/.exec(value)
  if (quoted) return quoted[2]!
  // Strip an unquoted trailing comment; a URL never contains an unescaped `#`.
  return value.split(/\s+#/)[0]!.trim()
}

/**
 * The database identities a developer has configured, parsed from raw env-file
 * contents. The canonical disposable scratch database is never reported: it is
 * the intended test target, so fencing it would refuse every legitimate run.
 *
 * @param fileContents - raw text of each env file, in any order. Missing files
 *   are represented by omitting them, not by a sentinel.
 */
export function parseConfiguredDatabaseIdentities(
  fileContents: readonly string[],
): readonly DatabaseIdentity[] {
  const scratch = databaseIdentity(DEFAULT_TEST_DATABASE_URL)
  const keys = new Set<string>(CONFIGURED_DATABASE_ENV_KEYS)
  const seen = new Map<string, DatabaseIdentity>()

  for (const contents of fileContents) {
    for (const line of contents.split(/\r?\n/)) {
      const match = ASSIGNMENT.exec(line)
      if (!match || !keys.has(match[1]!)) continue
      const identity = databaseIdentity(unquote(match[2]!))
      if (!identity) continue
      if (scratch && sameDatabaseIdentity(identity, scratch)) continue
      const key = `${canonicalHost(identity.host)}:${identity.port}/${identity.database}`
      if (!seen.has(key)) seen.set(key, identity)
    }
  }
  return Object.freeze([...seen.values()])
}

let cached: readonly DatabaseIdentity[] | undefined

/** The configured development databases for this checkout, read once. */
function configuredDatabaseIdentities(): readonly DatabaseIdentity[] {
  if (cached) return cached
  const contents: string[] = []
  for (const file of CONFIGURED_DATABASE_ENV_FILES) {
    try {
      contents.push(readFileSync(new URL(file, `file://${REPO_ROOT}`), 'utf8'))
    } catch {
      // An absent developer file simply contributes no refusal.
    }
  }
  cached = parseConfiguredDatabaseIdentities(contents)
  return cached
}

/**
 * Refuse a target that is a configured development database.
 *
 * @throws {TestEnvironmentError} code `configured_development_database`.
 */
export function assertNotConfiguredDatabase(
  databaseUrl: string,
  configured: readonly DatabaseIdentity[] = configuredDatabaseIdentities(),
): void {
  if (configured.length === 0) return
  const target = databaseIdentity(databaseUrl)
  if (!target) return
  if (!configured.some((identity) => sameDatabaseIdentity(identity, target))) return

  throw new TestEnvironmentError(
    'configured_development_database',
    `Refusing to run against "${target.database}" on ${canonicalHost(target.host)}:${target.port}: ` +
      'it is the database this checkout is configured for development. ' +
      'Migrating or mutating it leaves a ledger no commit describes. ' +
      'Create a disposable database instead, e.g. ' +
      'TEST_DATABASE_URL=postgresql://test:test@localhost:5432/repkey_scratch_<stamp>. ' +
      'This fence has no override.',
  )
}
