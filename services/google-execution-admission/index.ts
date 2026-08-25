import { randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import Redis from 'ioredis'
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

assertGoogleAdmissionRequiredEnvironment(process.env)

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`required execution-admission setting is missing: ${name}`)
  return value
}

function portFromEnv(): number {
  const raw = process.env.PORT ?? '8443'
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error('execution-admission port is invalid')
  }
  const port = Number(raw)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('execution-admission port is invalid')
  }
  return port
}

const { databaseTls, grantKeyring, pool, redis } = consumeGoogleAdmissionRuntimeSecrets(
  process.env,
  (secrets) => {
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
        }),
      }
    } catch (error) {
      databaseTls.dispose()
      throw error
    }
  },
)
pool.on('error', () => {
  process.stderr.write('execution_admission_db_idle_error\n')
})

redis.on('error', () => {
  process.stderr.write('execution_admission_redis_error\n')
})
await redis.connect()

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
try {
  const [redisReply, databaseReady] = await Promise.all([
    redis.ping(),
    authority.readiness(),
  ])
  if (redisReply !== 'PONG' || !databaseReady) {
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
const server = createInternalMtlsWebServer({
  host: process.env.HOST ?? '0.0.0.0',
  port: portFromEnv(),
  tls,
  maxRequestBytes: 32 * 1024,
  resolvePeerIdentity: createGoogleAdmissionPeerIdentityResolver(),
  handle: (request, peerIdentity) =>
    handleGoogleExecutionAdmissionRequest({
      request,
      gatewayIdentity: peerIdentity,
      service,
      readiness: async () => {
        try {
          const [redisReply, databaseReady] = await Promise.all([
            redis.ping(),
            authority.readiness(),
          ])
          return redisReply === 'PONG' && databaseReady
        } catch {
          return false
        }
      },
    }),
})

server.listen(portFromEnv(), process.env.HOST ?? '0.0.0.0')

let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  await new Promise<void>((resolve) => server.close(() => resolve()))
  try {
    await Promise.allSettled([redis.quit(), pool.end()])
  } finally {
    databaseTls.dispose()
    grantKeyring.dispose()
    tls.ca.fill(0)
    tls.cert.fill(0)
    tls.key.fill(0)
  }
}

process.once('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0))
})
process.once('SIGINT', () => {
  void shutdown().finally(() => process.exit(0))
})
