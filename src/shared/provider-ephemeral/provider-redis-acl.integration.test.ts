// The provider Redis ACL, as the image actually builds it, against a real
// Redis.
//
// services/google-provider-redis/entrypoint.sh writes the one ACL user the app
// connects as. Redis applies those rules left to right, so a grant written
// before a category removal is silently revoked by it: `+info -@dangerous`
// took INFO back, because INFO is itself @dangerous. The app's inspection
// (verifyProviderEphemeralRedisRuntime) calls INFO before it will hand out a
// Google OAuth state handle, so every Google connect on closed-beta-v2 failed
// with `inspection_unavailable` — and no test ever loaded the real rules: the
// e2e stack does not run this image, and the unit test mocks Redis.
//
// This suite reads the rules out of the entrypoint and asks Redis itself.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Redis } from 'ioredis'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import {
  PROVIDER_REDIS_FORBIDDEN_COMMANDS,
  PROVIDER_REDIS_INSPECTION_COMMANDS,
} from './runtime-verification'

const ENTRYPOINT = resolve(
  import.meta.dirname,
  '../../../services/google-provider-redis/entrypoint.sh',
)

/** The key patterns and command rules the entrypoint writes for its user. */
function entrypointAclRules(): ReadonlyArray<string> {
  const script = readFileSync(ENTRYPOINT, 'utf8')
  const keys = /printf 'user %s on #%s ([^']*)'/u.exec(script)?.[1]
  const commands = /printf '%s\\n' '(\+@[^']*)'/u.exec(script)?.[1]
  if (!keys || !commands) {
    throw new Error(`could not find the ACL user rules in ${ENTRYPOINT}`)
  }
  return `${keys} ${commands}`.split(/\s+/u).filter(Boolean)
}

async function dryRun(redis: Redis, user: string, command: readonly string[]) {
  try {
    return String(await redis.call('ACL', 'DRYRUN', user, ...command))
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('google-provider-redis ACL (entrypoint.sh) on a real Redis', () => {
  let lease: RedisTestLease
  const user = `repkey_acl_probe_${randomUUID().slice(0, 8)}`

  beforeAll(async () => {
    lease = await acquireRedisTestLease()
    if (!lease.available || !lease.redis) return
    await lease.redis.call(
      'ACL',
      'SETUSER',
      user,
      'reset',
      'on',
      `>${randomUUID()}`,
      ...entrypointAclRules(),
    )
  })

  afterAll(async () => {
    if (lease.available && lease.redis) await lease.redis.call('ACL', 'DELUSER', user)
    lease.release()
  })

  it.each(
    PROVIDER_REDIS_INSPECTION_COMMANDS.map((command) => [command.join(' '), command]),
  )('grants the inspection command %s', async (_label, command) => {
    if (!lease.available || !lease.redis) return
    expect(await dryRun(lease.redis, user, command)).toBe('OK')
  })

  it.each(PROVIDER_REDIS_FORBIDDEN_COMMANDS.map((command) => [command[0], command]))(
    'still denies %s',
    async (_label, command) => {
      if (!lease.available || !lease.redis) return
      expect(await dryRun(lease.redis, user, command)).not.toBe('OK')
    },
  )
})
