import type { Redis } from 'ioredis'

export const PROVIDER_REDIS_FORBIDDEN_COMMANDS = [
  ['SAVE'],
  ['BGSAVE'],
  ['BGREWRITEAOF'],
  ['CONFIG', 'SET', 'save', '60 1'],
  ['MODULE', 'LOAD', '/tmp/forbidden.so'],
  [
    'FUNCTION',
    'LOAD',
    "#!lua name=forbidden\nredis.register_function('f', function() return 1 end)",
  ],
  ['MIGRATE', '127.0.0.1', '1', 'provider-probe', '0', '1', 'COPY'],
  ['DUMP', 'provider-probe'],
  ['RESTORE', 'provider-probe', '1', 'forbidden', 'REPLACE'],
  ['REPLICAOF', '127.0.0.1', '1'],
  ['SLAVEOF', '127.0.0.1', '1'],
  ['SYNC'],
  ['PSYNC', '?', '-1'],
  ['SHUTDOWN', 'SAVE'],
  ['FLUSHALL'],
  ['FLUSHDB'],
  ['KEYS', '*'],
  ['CLIENT', 'KILL', 'TYPE', 'NORMAL', 'SKIPME', 'YES'],
] as const

export type ProviderRedisReadinessCode =
  | 'url_missing'
  | 'url_not_tls'
  | 'url_auth_missing'
  | 'url_not_dedicated'
  | 'inspection_unavailable'
  | 'persistence_enabled'
  | 'persistence_state_invalid'
  | 'replication_enabled'
  | 'maxmemory_unbounded'
  | 'maxmemory_policy_invalid'
  | 'acl_user_default'
  | 'persistence_command_allowed'
export type ProviderRedisReadiness =
  | Readonly<{
      ok: true
      maxmemoryBytes: number
      maxmemoryPolicy: 'volatile-ttl' | 'noeviction'
    }>
  | Readonly<{ ok: false; code: ProviderRedisReadinessCode }>

export function validateProviderEphemeralRedisUrls(
  providerUrl: string | undefined,
  generalRedisUrl: string | undefined,
  queueRedisUrl?: string,
): Readonly<{ ok: false; code: ProviderRedisReadinessCode }> | null {
  if (!providerUrl) return { ok: false, code: 'url_missing' }
  let parsed: URL
  try {
    parsed = new URL(providerUrl)
  } catch {
    return { ok: false, code: 'url_not_tls' }
  }
  if (parsed.protocol !== 'rediss:') return { ok: false, code: 'url_not_tls' }
  if (!parsed.username || !parsed.password) {
    return { ok: false, code: 'url_auth_missing' }
  }
  for (const candidateUrl of [generalRedisUrl, queueRedisUrl]) {
    if (!candidateUrl) continue
    try {
      const candidate = new URL(candidateUrl)
      const endpoint = (url: URL) => `${url.hostname.toLowerCase()}:${url.port || '6379'}`
      if (endpoint(parsed) === endpoint(candidate)) {
        return { ok: false, code: 'url_not_dedicated' }
      }
    } catch {
      return { ok: false, code: 'url_not_dedicated' }
    }
  }
  return null
}

function configMap(raw: readonly string[]): ReadonlyMap<string, string> {
  const result = new Map<string, string>()
  for (let index = 0; index + 1 < raw.length; index += 2) {
    result.set(raw[index]!.toLowerCase(), raw[index + 1]!)
  }
  return result
}

function infoMap(raw: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf(':')
    if (separator < 1) continue
    result.set(line.slice(0, separator).toLowerCase(), line.slice(separator + 1))
  }
  return result
}

async function commandDenied(
  redis: Redis,
  user: string,
  command: readonly string[],
): Promise<boolean> {
  try {
    const result = await redis.call('ACL', 'DRYRUN', user, ...command)
    return typeof result === 'string' && result.toUpperCase() !== 'OK'
  } catch (error) {
    return error instanceof Error && error.message.startsWith('NOPERM')
  }
}

/**
 * Inspect the dedicated provider Redis itself. Any unavailable control or
 * ambiguous response is a denial; callers log only the returned code.
 */
export async function verifyProviderEphemeralRedisRuntime(
  redis: Redis,
): Promise<ProviderRedisReadiness> {
  try {
    const rawConfig = await redis.config(
      'GET',
      'appendonly',
      'save',
      'maxmemory',
      'maxmemory-policy',
    )
    if (!Array.isArray(rawConfig)) {
      return { ok: false, code: 'inspection_unavailable' }
    }
    const config = configMap(rawConfig as string[])
    const rawInfo = await redis.info()
    if (typeof rawInfo !== 'string') {
      return { ok: false, code: 'inspection_unavailable' }
    }
    const info = infoMap(rawInfo)
    if (
      info.get('loading') !== '0' ||
      info.get('aof_enabled') !== '0' ||
      info.get('rdb_bgsave_in_progress') !== '0' ||
      info.get('aof_rewrite_in_progress') !== '0' ||
      info.get('module_fork_in_progress') !== '0'
    ) {
      return { ok: false, code: 'persistence_state_invalid' }
    }
    if (
      info.get('role') !== 'master' ||
      info.get('connected_slaves') !== '0' ||
      info.get('repl_backlog_active') !== '0'
    ) {
      return { ok: false, code: 'replication_enabled' }
    }
    if (config.get('appendonly') !== 'no' || (config.get('save') ?? '') !== '') {
      return { ok: false, code: 'persistence_enabled' }
    }
    const maxmemoryBytes = Number(config.get('maxmemory'))
    if (!Number.isSafeInteger(maxmemoryBytes) || maxmemoryBytes <= 0) {
      return { ok: false, code: 'maxmemory_unbounded' }
    }
    const policy = config.get('maxmemory-policy')
    if (policy !== 'volatile-ttl' && policy !== 'noeviction') {
      return { ok: false, code: 'maxmemory_policy_invalid' }
    }
    const user = await redis.call('ACL', 'WHOAMI')
    if (typeof user !== 'string' || user.length === 0) {
      return { ok: false, code: 'inspection_unavailable' }
    }
    if (user === 'default') return { ok: false, code: 'acl_user_default' }
    const denials = await Promise.all(
      PROVIDER_REDIS_FORBIDDEN_COMMANDS.map((command) =>
        commandDenied(redis, user, command),
      ),
    )
    if (denials.some((denied) => !denied)) {
      return { ok: false, code: 'persistence_command_allowed' }
    }
    return { ok: true, maxmemoryBytes, maxmemoryPolicy: policy }
  } catch {
    return { ok: false, code: 'inspection_unavailable' }
  }
}
