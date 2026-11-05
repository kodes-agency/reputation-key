import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'
import { describe, expect, it } from 'vitest'
import { assertLocalE2eSeedTarget } from './e2e-seed-target'

const ROOT = resolve(import.meta.dirname, '../..')

/** The committed local stack, as `scripts/e2e/stack-services.sh` hands it to the seeder. */
const STACK = parse(readFileSync(resolve(ROOT, 'e2e/stack.env')))

type Env = Readonly<Record<string, string | undefined>>

const seederEnv = (overrides: Env = {}): Env => ({
  ...STACK,
  LOCAL_TOOL_EXECUTION_IDENTITY: STACK.HOST_LOCAL_TOOL_EXECUTION_IDENTITY,
  ...overrides,
})

/** Names that never resolve, so a script that dials them fails on the lookup instead of reaching anything. */
const DEPLOYED_DATABASE_URL =
  'postgresql://postgres:not-a-real-password@db.example.invalid:5432/railway'
const DEPLOYED_REDIS_URL =
  'redis://default:not-a-real-password@redis.example.invalid:6379'
/** A database on this machine that nothing listens on: a seeder that got past its guard would fail to connect. */
const UNREACHABLE_LOCAL_DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/repkey_test'

const refusal = (env: Env): string => {
  try {
    assertLocalE2eSeedTarget(env)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return 'accepted'
}

describe('assertLocalE2eSeedTarget', () => {
  it('accepts the committed local stack', () => {
    expect(refusal(seederEnv())).toBe('accepted')
  })

  it('refuses a shell that does not claim the stack identity', () => {
    expect(refusal(seederEnv({ LOCAL_TOOL_EXECUTION_IDENTITY: undefined }))).toBe(
      'Local-only command refused: the e2e host execution identity is missing or invalid',
    )
  })

  it('refuses a deployed database', () => {
    expect(refusal(seederEnv({ DATABASE_URL: DEPLOYED_DATABASE_URL }))).toBe(
      'Local-only script refused: DATABASE_URL points at host "db.example.invalid", not at this machine',
    )
  })

  it('refuses a tunnel to a deployed database, which ends on loopback', () => {
    expect(
      refusal(seederEnv({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:55432/railway' })),
    ).toBe(
      'Local-only script refused: database "railway" does not name itself local, dev, test, scratch or sim',
    )
  })

  it('refuses a Redis on another host, even beside a local database', () => {
    expect(refusal(seederEnv({ REDIS_URL: DEPLOYED_REDIS_URL }))).toBe(
      'Local-only script refused: REDIS_URL points at host "redis.example.invalid", not at this machine',
    )
  })
})

/** This process's environment without any Railway variable, so the target is what refuses. */
function plainShell(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('RAILWAY_')),
  )
}

describe('scripts/seed-e2e-user.ts, started against a target that is not local', () => {
  it.each([
    [
      'a deployed database',
      { DATABASE_URL: DEPLOYED_DATABASE_URL },
      'db.example.invalid',
    ],
    [
      'a deployed Redis',
      { DATABASE_URL: UNREACHABLE_LOCAL_DATABASE_URL, REDIS_URL: DEPLOYED_REDIS_URL },
      'redis.example.invalid',
    ],
  ])(
    'refuses %s before it opens a connection',
    (_name, target, host) => {
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/seed-e2e-user.ts'],
        {
          cwd: ROOT,
          encoding: 'utf8',
          env: {
            ...plainShell(),
            NODE_ENV: 'test',
            LOCAL_TOOL_EXECUTION_IDENTITY: STACK.HOST_LOCAL_TOOL_EXECUTION_IDENTITY,
            ...target,
          },
        },
      )
      const output = `${result.stdout}${result.stderr}`

      expect(output).toContain('Local-only script refused')
      expect(output).toContain(host)
      // Refused, not failed on the way to the host.
      expect(output).not.toContain('ENOTFOUND')
      expect(output).not.toContain('ECONNREFUSED')
      expect(output).not.toContain('not-a-real-password')
      expect(result.status).toBe(1)
    },
    60_000,
  )
})
