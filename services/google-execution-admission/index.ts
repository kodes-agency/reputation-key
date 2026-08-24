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
import { createInternalMtlsWebServer, loadInternalMtlsMaterial } from '../internal-mtls'
import {
  assertGoogleEgressGatewayIdentity,
  createGoogleAdmissionPeerIdentityResolver,
} from '../google-peer-identities'

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

const pool = new Pool({
  connectionString: requiredEnv('DATABASE_URL'),
  max: 5,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
})
pool.on('error', () => {
  process.stderr.write('execution_admission_db_idle_error\n')
})

const redis = new Redis(requiredEnv('REDIS_URL'), {
  lazyConnect: true,
  enableAutoPipelining: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 5_000,
  commandTimeout: 5_000,
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

const grantKeyring = createVersionedHmacKeyring(
  requiredEnv('GOOGLE_ADMISSION_GRANT_HMAC_KEYS'),
)
const service = createGoogleExecutionAdmissionService({
  nowMs: Date.now,
  admissionId: () => randomBytes(24).toString('base64url'),
  grantKeyring,
  grantStore: createRedisGoogleAdmissionGrantStore(redis, Date.now),
  authority: createPostgresGoogleAdmissionPermitAuthority({
    pool,
    now: () => new Date(),
    gatewayIdentity,
  }),
  quotaForPolicy: (policyId) => quotaCoordinators.get(policyId) ?? null,
  inFlightForPolicy: (policyId) => inFlightCoordinators.get(policyId) ?? null,
})

const tls = loadInternalMtlsMaterial({
  caPath: requiredEnv('GOOGLE_INTERNAL_MTLS_CA_PATH'),
  certPath: requiredEnv('GOOGLE_INTERNAL_MTLS_CERT_PATH'),
  keyPath: requiredEnv('GOOGLE_INTERNAL_MTLS_KEY_PATH'),
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
          const [redisReply] = await Promise.all([redis.ping(), pool.query('SELECT 1')])
          return redisReply === 'PONG'
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
  await Promise.allSettled([redis.quit(), pool.end()])
}

process.once('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0))
})
process.once('SIGINT', () => {
  void shutdown().finally(() => process.exit(0))
})
