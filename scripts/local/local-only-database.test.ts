import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertLocalOnlyDatabase } from './local-only-database'

const ROOT = resolve(import.meta.dirname, '../..')

/** The local stack's database, as `e2e/stack.env` addresses it from the host. */
const LOCAL_STACK_URL =
  'postgresql://repkey_local:stack-password@127.0.0.1:55432/repkey_local'

/**
 * A deployed database as an operator's shell holds it for `pnpm ops`. The
 * `.invalid` top-level domain never resolves, so a script that dials it fails
 * on the lookup instead of reaching anything.
 */
const DEPLOYED_DATABASE_URL =
  'postgresql://postgres:not-a-real-password@db.example.invalid:5432/railway'

const refusal = (env: Readonly<Record<string, string | undefined>>): string => {
  try {
    assertLocalOnlyDatabase(env)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return 'accepted'
}

describe('assertLocalOnlyDatabase', () => {
  it('accepts the local stack and reports where the script will write', () => {
    expect(assertLocalOnlyDatabase({ DATABASE_URL: LOCAL_STACK_URL })).toEqual({
      host: '127.0.0.1',
      database: 'repkey_local',
    })
  })

  it.each([
    ['localhost', 'postgresql://u:p@localhost:5432/repkey_dev'],
    ['IPv6 loopback', 'postgresql://u:p@[::1]:5432/repkey_test'],
    [
      'a Unix socket directory',
      'postgresql://u:p@localhost/repkey_local?host=/var/run/postgresql',
    ],
  ])('accepts %s', (_name, url) => {
    expect(refusal({ DATABASE_URL: url })).toBe('accepted')
  })

  it('refuses a host that is not this machine, naming it', () => {
    expect(refusal({ DATABASE_URL: DEPLOYED_DATABASE_URL })).toBe(
      'Local-only script refused: DATABASE_URL points at host "db.example.invalid", not at this machine',
    )
  })

  it.each([
    [
      'a Railway private address',
      'postgresql://u:p@postgres.railway.internal:5432/repkey_local',
    ],
    [
      'a name that only starts like loopback',
      'postgresql://u:p@127.0.0.1.example.invalid/repkey_local',
    ],
  ])('refuses %s', (_name, url) => {
    expect(refusal({ DATABASE_URL: url })).toContain('not at this machine')
  })

  // The driver takes a `host` parameter over the host written in the address,
  // so the address alone would read as local.
  it('refuses a loopback address whose host parameter sends the driver elsewhere', () => {
    expect(
      refusal({
        DATABASE_URL:
          'postgresql://u:p@localhost:5432/repkey_local?host=db.example.invalid',
      }),
    ).toBe(
      'Local-only script refused: DATABASE_URL points at host "db.example.invalid", not at this machine',
    )
  })

  // Loopback says where the connection starts. A tunnel or port-forward to a
  // deployed database ends on loopback too.
  it.each([
    ['railway', "Railway's default database, reached through a tunnel"],
    ['reputation_key', 'a name that says nothing'],
    ['localization', 'a word that only contains "local"'],
    ['production', 'a deployed name'],
  ])('refuses database "%s" on loopback: %s', (database) => {
    expect(refusal({ DATABASE_URL: `postgresql://u:p@127.0.0.1:5432/${database}` })).toBe(
      `Local-only script refused: database "${database}" does not name itself local, dev, test, scratch or sim`,
    )
  })

  it.each([
    ['RAILWAY_PROJECT_ID', '4f6c0f6e-0000-4000-8000-000000000000'],
    ['RAILWAY_ENVIRONMENT_ID', 'b1d0c1a2-0000-4000-8000-000000000000'],
    ['RAILWAY_SERVICE_NAME', 'web'],
    ['RAILWAY_ENVIRONMENT', ''],
  ])('refuses a shell that carries %s, even with a local address', (name, value) => {
    expect(refusal({ DATABASE_URL: LOCAL_STACK_URL, [name]: value })).toBe(
      `Local-only script refused: this shell carries a deployed service's environment (${name})`,
    )
  })

  it('refuses a production-mode process, even with a local address', () => {
    expect(refusal({ DATABASE_URL: LOCAL_STACK_URL, NODE_ENV: 'production' })).toBe(
      'Local-only script refused: NODE_ENV is production',
    )
  })

  it.each([
    ['no address', undefined, 'DATABASE_URL is not set'],
    ['a blank address', '  ', 'DATABASE_URL is not set'],
    [
      'text that is not an address',
      'repkey_local',
      'DATABASE_URL is not a PostgreSQL address',
    ],
    [
      'another database kind',
      'mysql://u:p@127.0.0.1/repkey_local',
      'DATABASE_URL is not a PostgreSQL address',
    ],
  ])('refuses %s', (_name, url, reason) => {
    expect(refusal({ DATABASE_URL: url })).toBe(`Local-only script refused: ${reason}`)
  })

  it('never repeats the password in a refusal', () => {
    expect(refusal({ DATABASE_URL: DEPLOYED_DATABASE_URL })).not.toContain(
      'not-a-real-password',
    )
  })
})

/** The two development scripts that delete rows from whatever `DATABASE_URL` names. */
const CLEANUP_SCRIPTS = ['scripts/cleanup-all.ts', 'scripts/cleanup-kodes.ts'] as const

/** This process's environment without any Railway variable, so the host is what refuses. */
function plainShell(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('RAILWAY_')),
  )
}

function run(script: string, env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...plainShell(), ...env },
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

describe('the cleanup scripts, started against a deployed database', () => {
  it.each(CLEANUP_SCRIPTS)(
    '%s refuses before it opens a connection',
    (script) => {
      const { status, output } = run(script, { DATABASE_URL: DEPLOYED_DATABASE_URL })

      expect(output).toContain('Local-only script refused')
      expect(output).toContain('db.example.invalid')
      // Refused, not failed on the way to the host.
      expect(output).not.toContain('ENOTFOUND')
      expect(output).not.toContain('Deleting')
      expect(output).not.toContain('not-a-real-password')
      expect(status).toBe(1)
    },
    60_000,
  )
})
