import { randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import Redis from 'ioredis'
import {
  validateProviderEphemeralRedisUrls,
  verifyProviderEphemeralRedisRuntime,
} from '../../src/shared/provider-ephemeral/runtime-verification'
import { createVersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import {
  GOOGLE_QUOTA_POLICIES,
  createRedisGoogleInFlightCoordinator,
  createRedisGoogleQuotaCoordinator,
} from '../../src/shared/google-provider-control/quota-coordinator'
import { createRedisGoogleAdmissionGrantStore } from '../../src/shared/google-provider-control/admission-grant-store'
import { createGoogleExecutionAdmissionService } from './service'
import { createPostgresGoogleAdmissionPermitAuthority } from './postgres-permit-authority'
import { handleGoogleExecutionAdmissionRequest } from './http-api'
import {
  createInternalMtlsWebServer,
  loadInternalMtlsMaterialFromOneSource,
} from '../internal-mtls'
import {
  assertGoogleEgressGatewayIdentity,
  createGoogleAdmissionPeerIdentityResolver,
} from '../google-peer-identities'
import { loadGoogleAdmissionDatabaseTlsConfiguration } from './database-tls'
import { assertGoogleAdmissionRequiredEnvironment } from './environment'
import { consumeGoogleAdmissionRuntimeSecrets } from './runtime-secrets'
import { createSidecarPlatformHealthServer } from '../platform-health'
import { registerSidecarOperationalLifecycle } from '../sidecar-operational-runtime'
import { monitoredSidecarObservability } from '../sidecar-monitored-observability'
import { resolveSidecarRuntimePorts } from '../sidecar-runtime-ports'
import { captureObservabilityException } from '../../src/shared/observability/telemetry'

assertGoogleAdmissionRequiredEnvironment(process.env)

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`required execution-admission setting is missing: ${name}`)
  return value
}

const { databaseTls, grantKeyring, pool, redis } = consumeGoogleAdmissionRuntimeSecrets(
  process.env,
  (secrets) => {
    if (process.env.NODE_ENV === 'production') {
      const redisUrlFailure = validateProviderEphemeralRedisUrls(
        secrets.REDIS_URL,
        undefined,
      )
      if (redisUrlFailure) {
        throw new Error(`Google admission Redis denied: ${redisUrlFailure.code}`)
      }
    }
    const databaseTls = loadGoogleAdmissionDatabaseTlsConfiguration({
      connectionString: secrets.DATABASE_URL,
      caBase64: secrets.GOOGLE_ADMISSION_DATABASE_CA_B64,
    })
    try {
      return {
        databaseTls,
        grantKeyring: createVersionedHmacKeyring(
          secrets.GOOGLE_ADMISSION_GRANT_HMAC_KEYS,
        ),
        pool: new Pool({
          connectionString: databaseTls.connectionString,
          ssl: databaseTls.ssl,
          max: 5,
          connectionTimeoutMillis: 1_000,
          idleTimeoutMillis: 5_000,
          application_name: 'repkey-google-execution-admission',
        }),
        redis: new Redis(secrets.REDIS_URL, {
          lazyConnect: true,
          enableAutoPipelining: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 5_000,
          commandTimeout: 5_000,
          disableClientInfo: true,
          ...(secrets.PROVIDER_REDIS_TLS_CA_PEM
            ? { tls: { ca: secrets.PROVIDER_REDIS_TLS_CA_PEM } }
            : {}),
        }),
      }
    } catch (error) {
      databaseTls.dispose()
      throw error
    }
  },
)
pool.on('error', (error) => {
  captureObservabilityException(error, { source: 'sidecar-dependency' })
  process.stderr.write('execution_admission_db_idle_error\n')
})

redis.on('error', (error) => {
  captureObservabilityException(error, { source: 'sidecar-dependency' })
  process.stderr.write('execution_admission_redis_error\n')
})
await redis.connect()
if (process.env.NODE_ENV === 'production') {
  const readiness = await verifyProviderEphemeralRedisRuntime(redis)
  if (!readiness.ok) {
    throw new Error(`Google admission Redis denied: ${readiness.code}`)
  }
}

const gatewayIdentity = assertGoogleEgressGatewayIdentity(
  requiredEnv('GOOGLE_EGRESS_GATEWAY_IDENTITY'),
)
const quotaCoordinators = new Map()
const inFlightCoordinators = new Map()
for (const [policyId, policy] of Object.entries(GOOGLE_QUOTA_POLICIES)) {
  quotaCoordinators.set(
    policyId,
    createRedisGoogleQuotaCoordinator({
      redis,
      nowMs: Date.now,
      policyId,
      policy,
    }),
  )
  inFlightCoordinators.set(
    policyId,
    createRedisGoogleInFlightCoordinator({
      redis,
      nowMs: Date.now,
      leaseId: () => randomBytes(24).toString('base64url'),
      policyId,
      policy,
    }),
  )
}

const authority = createPostgresGoogleAdmissionPermitAuthority({
  pool,
  gatewayIdentity,
  releaseSha: requiredEnv('RELEASE_SHA'),
})
const readiness = async (signal: AbortSignal): Promise<boolean> => {
  if (signal.aborted) return false
  try {
    const [redisReply, databaseReady] = await Promise.all([
      redis.ping(),
      authority.readiness(),
    ])
    return !signal.aborted && redisReply === 'PONG' && databaseReady
  } catch {
    return false
  }
}
try {
  if (!(await readiness(AbortSignal.timeout(5_000)))) {
    throw new Error('Google execution-admission dependencies are not ready')
  }
} catch (error) {
  await Promise.allSettled([redis.quit(), pool.end()])
  databaseTls.dispose()
  grantKeyring.dispose()
  throw error
}
const service = createGoogleExecutionAdmissionService({
  nowMs: Date.now,
  admissionId: () => randomBytes(24).toString('base64url'),
  grantKeyring,
  grantStore: createRedisGoogleAdmissionGrantStore(redis, Date.now),
  authority,
  quotaForPolicy: (policyId) => quotaCoordinators.get(policyId) ?? null,
  inFlightForPolicy: (policyId) => inFlightCoordinators.get(policyId) ?? null,
})

const base64Tls = [
  process.env.GOOGLE_INTERNAL_MTLS_CA_B64,
  process.env.GOOGLE_INTERNAL_MTLS_CERT_B64,
  process.env.GOOGLE_INTERNAL_MTLS_KEY_B64,
] as const
const pathTls = [
  process.env.GOOGLE_INTERNAL_MTLS_CA_PATH,
  process.env.GOOGLE_INTERNAL_MTLS_CERT_PATH,
  process.env.GOOGLE_INTERNAL_MTLS_KEY_PATH,
] as const
const tls = loadInternalMtlsMaterialFromOneSource({
  base64: { ca: base64Tls[0], cert: base64Tls[1], key: base64Tls[2] },
  path: { ca: pathTls[0], cert: pathTls[1], key: pathTls[2] },
})
const host = process.env.HOST ?? '0.0.0.0'
const { healthPort, protectedMtlsPort } = resolveSidecarRuntimePorts(process.env)
const server = createInternalMtlsWebServer({
  host,
  port: protectedMtlsPort,
  tls,
  maxRequestBytes: 32 * 1024,
  resolvePeerIdentity: createGoogleAdmissionPeerIdentityResolver(),
  handle: (request, peerIdentity) =>
    handleGoogleExecutionAdmissionRequest({
      request,
      gatewayIdentity: peerIdentity,
      service,
      readiness: () => readiness(AbortSignal.timeout(2_000)),
    }),
})
const platformHealth = createSidecarPlatformHealthServer({
  host,
  healthPort,
  protectedMtlsPort,
  readiness,
})

let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  let failure: unknown
  try {
    await server.stopAndDrain()
  } catch (error) {
    failure = error
  }
  for (const operation of [redis.quit(), pool.end()]) {
    try {
      await operation
    } catch (error) {
      failure ??= error
    }
  }
  try {
    if (failure !== undefined) throw failure
  } finally {
    databaseTls.dispose()
    grantKeyring.dispose()
    tls.ca.fill(0)
    tls.cert.fill(0)
    tls.key.fill(0)
  }
}

try {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(protectedMtlsPort, host, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  await platformHealth.listen()
} catch (error) {
  platformHealth.beginDrain()
  await Promise.allSettled([shutdown(), platformHealth.stop()])
  throw error
}

registerSidecarOperationalLifecycle({
  service: 'google-execution-admission',
  health: platformHealth,
  shutdown,
  shutdownTimeoutMs: 25_000,
  capture: monitoredSidecarObservability.capture,
  flush: monitoredSidecarObservability.flush,
})
