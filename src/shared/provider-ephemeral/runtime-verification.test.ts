import { describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'
import {
  PROVIDER_REDIS_FORBIDDEN_COMMANDS,
  validateProviderEphemeralRedisUrls,
  verifyProviderEphemeralRedisRuntime,
} from './runtime-verification'

function redisWith(overrides: Partial<Redis> = {}): Redis {
  return {
    config: vi
      .fn()
      .mockResolvedValue([
        'appendonly',
        'no',
        'save',
        '',
        'maxmemory',
        '67108864',
        'maxmemory-policy',
        'volatile-ttl',
      ]),
    info: vi
      .fn()
      .mockResolvedValue(
        [
          '# Persistence',
          'loading:0',
          'aof_enabled:0',
          'rdb_bgsave_in_progress:0',
          'aof_rewrite_in_progress:0',
          'module_fork_in_progress:0',
          '# Replication',
          'role:master',
          'connected_slaves:0',
          'repl_backlog_active:0',
        ].join('\r\n'),
      ),
    call: vi.fn(async (...args: unknown[]) => {
      if (args[0] === 'ACL' && args[1] === 'WHOAMI') return 'provider-app'
      if (args[0] === 'ACL' && args[1] === 'DRYRUN') return 'NOPERM denied'
      throw new Error('unexpected command')
    }),
    ...overrides,
  } as unknown as Redis
}

describe('provider ephemeral Redis readiness', () => {
  it('requires a distinct TLS endpoint', () => {
    expect(validateProviderEphemeralRedisUrls(undefined, undefined)).toEqual({
      ok: false,
      code: 'url_missing',
    })
    expect(
      validateProviderEphemeralRedisUrls('redis://provider:6379', undefined),
    ).toEqual({ ok: false, code: 'url_not_tls' })
    expect(
      validateProviderEphemeralRedisUrls('rediss://provider:6379', undefined),
    ).toEqual({ ok: false, code: 'url_auth_missing' })
    expect(
      validateProviderEphemeralRedisUrls(
        'rediss://provider-app:secret@provider:6379',
        'rediss://general-app:other@PROVIDER:6379/1',
      ),
    ).toEqual({ ok: false, code: 'url_not_dedicated' })
    expect(
      validateProviderEphemeralRedisUrls(
        'rediss://provider-app:secret@provider:6379',
        'rediss://general-app:secret@general:6379',
      ),
    ).toBeNull()
    expect(
      validateProviderEphemeralRedisUrls(
        'rediss://provider-app:secret@queue:6379',
        'redis://cache:6379',
        'redis://queue:6379/1',
      ),
    ).toEqual({ ok: false, code: 'url_not_dedicated' })
  })

  it('accepts authenticated non-persistent bounded config with no replica backlog', async () => {
    await expect(verifyProviderEphemeralRedisRuntime(redisWith())).resolves.toEqual({
      ok: true,
      maxmemoryBytes: 67_108_864,
      maxmemoryPolicy: 'volatile-ttl',
    })
  })

  it.each([
    [
      'persistence_enabled',
      [
        'appendonly',
        'yes',
        'save',
        '',
        'maxmemory',
        '1',
        'maxmemory-policy',
        'volatile-ttl',
      ],
    ],
    [
      'maxmemory_unbounded',
      [
        'appendonly',
        'no',
        'save',
        '',
        'maxmemory',
        '0',
        'maxmemory-policy',
        'volatile-ttl',
      ],
    ],
    [
      'maxmemory_policy_invalid',
      [
        'appendonly',
        'no',
        'save',
        '',
        'maxmemory',
        '1',
        'maxmemory-policy',
        'allkeys-lru',
      ],
    ],
  ])('rejects %s configuration drift', async (code, config) => {
    const redis = redisWith({ config: vi.fn().mockResolvedValue(config) as never })
    await expect(verifyProviderEphemeralRedisRuntime(redis)).resolves.toEqual({
      ok: false,
      code,
    })
  })

  it.each([
    [
      'persistence_state_invalid',
      'loading:0\r\naof_enabled:1\r\nrdb_bgsave_in_progress:0\r\naof_rewrite_in_progress:0\r\nmodule_fork_in_progress:0\r\nrole:master\r\nconnected_slaves:0\r\nrepl_backlog_active:0',
    ],
    [
      'replication_enabled',
      'loading:0\r\naof_enabled:0\r\nrdb_bgsave_in_progress:0\r\naof_rewrite_in_progress:0\r\nmodule_fork_in_progress:0\r\nrole:slave\r\nconnected_slaves:0\r\nrepl_backlog_active:1',
    ],
  ])('rejects %s INFO drift', async (code, info) => {
    const redis = redisWith({ info: vi.fn().mockResolvedValue(info) as never })
    await expect(verifyProviderEphemeralRedisRuntime(redis)).resolves.toEqual({
      ok: false,
      code,
    })
  })

  it('rejects the default ACL user even when commands are denied', async () => {
    const redis = redisWith({
      call: vi.fn(async (...args: unknown[]) =>
        args[1] === 'WHOAMI' ? 'default' : 'NOPERM',
      ) as never,
    })
    await expect(verifyProviderEphemeralRedisRuntime(redis)).resolves.toEqual({
      ok: false,
      code: 'acl_user_default',
    })
  })

  it('rejects when any persistence-capable command is allowed', async () => {
    let dryRuns = 0
    const redis = redisWith({
      call: vi.fn(async (...args: unknown[]) => {
        if (args[1] === 'WHOAMI') return 'provider-app'
        dryRuns += 1
        return dryRuns === PROVIDER_REDIS_FORBIDDEN_COMMANDS.length ? 'OK' : 'NOPERM'
      }) as never,
    })
    await expect(verifyProviderEphemeralRedisRuntime(redis)).resolves.toEqual({
      ok: false,
      code: 'persistence_command_allowed',
    })
  })
})
