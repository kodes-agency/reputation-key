import { createHash } from 'node:crypto'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  createRedisDistributedRefreshSingleFlight,
  createRedisGoogleRefreshBackoffCoordinator,
  isRefreshCoordinationError,
  type RefreshCoordinationRedis,
} from '#/shared/google-provider-control/refresh-single-flight'
import type {
  GoogleRefreshCoordination,
  GoogleRefreshCoordinationDenyCode,
} from '../../application/ports/google-refresh-coordination.port'

const CONNECTION_FINGERPRINT_AUDIENCE = 'google-refresh-connection-v1'

type RefreshCoordinationAdapterError = Error &
  Readonly<{
    _tag: 'RefreshCoordinationAdapterError'
    code: GoogleRefreshCoordinationDenyCode
    retryAfterMs: number
  }>

function adapterError(
  code: GoogleRefreshCoordinationDenyCode,
  retryAfterMs: number,
): RefreshCoordinationAdapterError {
  return Object.assign(new Error(code), {
    _tag: 'RefreshCoordinationAdapterError' as const,
    code,
    retryAfterMs,
  })
}

function isAdapterError(value: unknown): value is RefreshCoordinationAdapterError {
  return (
    value instanceof Error &&
    '_tag' in value &&
    value._tag === 'RefreshCoordinationAdapterError'
  )
}

export function createRedisGoogleRefreshCoordination(
  deps: Readonly<{
    redis: RefreshCoordinationRedis
    connectionKeys: VersionedHmacKeyring
    nowMs: () => number
    sleep: (durationMs: number) => Promise<void>
    ownerId: () => string
    jitterSample: () => number
    leaseMs?: number
    pollMs?: number
  }>,
): GoogleRefreshCoordination {
  const singleFlight = createRedisDistributedRefreshSingleFlight({
    redis: deps.redis,
    nowMs: deps.nowMs,
    sleep: deps.sleep,
    ownerId: deps.ownerId,
    ...(deps.leaseMs === undefined ? {} : { leaseMs: deps.leaseMs }),
    ...(deps.pollMs === undefined ? {} : { pollMs: deps.pollMs }),
  })
  const backoff = createRedisGoogleRefreshBackoffCoordinator({
    redis: deps.redis,
    nowMs: deps.nowMs,
    jitterSample: deps.jitterSample,
  })

  return Object.freeze({
    run: async (input) => {
      const signedConnection = deps.connectionKeys.sign(
        CONNECTION_FINGERPRINT_AUDIENCE,
        `${input.organizationId}\u0000${input.connectionId}`,
      )
      const connectionFingerprint = createHash('sha256')
        .update(signedConnection.keyVersion, 'utf8')
        .update('\0', 'utf8')
        .update(signedConnection.digest, 'utf8')
        .digest('hex')
      const allowed = await backoff.check(connectionFingerprint)
      if (!allowed.ok) return allowed

      try {
        const value = await singleFlight.run({
          connectionFingerprint,
          deadlineMs: input.deadlineMs,
          loadLatest: input.loadLatest,
          refresh: async (assertLeadership) => {
            // A follower may have passed the first check before the previous
            // leader recorded a provider failure. Recheck only after taking
            // the lease so that shared backoff remains authoritative.
            const stillAllowed = await backoff.check(connectionFingerprint)
            if (!stillAllowed.ok) {
              throw adapterError(stillAllowed.code, stillAllowed.retryAfterMs)
            }
            try {
              const refreshed = await input.refresh(assertLeadership)
              // A completed credential CAS is authoritative even if clearing
              // short-lived backoff state fails afterwards. The next caller
              // re-reads the newer credential generation before provider work.
              await backoff.succeed(connectionFingerprint)
              return refreshed
            } catch (error) {
              if (isAdapterError(error)) throw error
              if (isRefreshCoordinationError(error)) throw error
              const failed = await backoff.fail(connectionFingerprint, null)
              if (
                !failed.ok &&
                (failed.code === 'coordination_unavailable' ||
                  failed.code === 'key_collision')
              ) {
                throw adapterError(failed.code, failed.retryAfterMs)
              }
              throw error
            }
          },
        })
        return { ok: true, value }
      } catch (error) {
        if (isRefreshCoordinationError(error)) {
          return { ok: false, code: error.code, retryAfterMs: 0 }
        }
        if (isAdapterError(error)) {
          return {
            ok: false,
            code: error.code,
            retryAfterMs: error.retryAfterMs,
          }
        }
        throw error
      }
    },
  })
}
