import { Pool } from 'pg'
import { createVersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import { AI_AUTHORIZE_MAX_BYTES } from '../../src/shared/ai-internal-transport-contract'
import { AI_SERVICE_HANDLER_DRAIN_TIMEOUT_MILLIS_V1 } from '../../src/shared/ai-openai-provider-profile'
import {
  assertAiAdmissionPrivateKeyInventory,
  assertAiRequestBindingKeyringInventory,
  resolveAiGatewayRuntimeKeyInventory,
} from '../../src/shared/ai-gateway-key-inventory'
import {
  createExactSpiffePeerIdentityResolver,
  createInternalMtlsWebServer,
  loadInternalMtlsMaterialFromBase64,
} from '../internal-mtls'
import { handleAiExecutionAdmissionRequest } from './http-api'
import { createPostgresAiAdmissionAuthority } from './postgres-admission-authority'
import { loadAiControlDatabaseTlsConfiguration } from './database-tls'
import { createAiExecutionAdmissionService } from './service'
import { assertAiAdmissionRequiredEnvironment } from './environment'
import { loadEd25519PrivateKey } from './key-material'
import { consumeAiAdmissionRuntimeSecrets } from './runtime-secrets'

const GATEWAY_IDENTITY = 'spiffe://repkey.internal/ai-egress-gateway'
assertAiAdmissionRequiredEnvironment(process.env)
const keyInventory = resolveAiGatewayRuntimeKeyInventory(process.env)

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`required AI admission setting is missing: ${name}`)
  return value
}

function portFromEnv(): number {
  const raw = process.env.PORT ?? '8443'
  if (!/^[0-9]+$/.test(raw)) throw new Error('AI admission port is invalid')
  const port = Number(raw)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('AI admission port is invalid')
  }
  return port
}

const signingKid = requiredEnv('AI_ADMISSION_ED25519_KID')
const { databaseTls, pool, requestBindingKeys, signingPrivateKey, tls } =
  consumeAiAdmissionRuntimeSecrets(process.env, (runtimeSecrets) => {
    const databaseTls = loadAiControlDatabaseTlsConfiguration({
      connectionString: runtimeSecrets.AI_CONTROL_DATABASE_URL,
      caBase64: runtimeSecrets.AI_CONTROL_DATABASE_CA_B64,
    })
    const pool = new Pool({
      connectionString: databaseTls.connectionString,
      ssl: databaseTls.ssl,
      max: 4,
      connectionTimeoutMillis: 1_000,
      idleTimeoutMillis: 5_000,
      application_name: 'repkey-ai-execution-admission',
    })
    const requestBindingKeys = createVersionedHmacKeyring(
      runtimeSecrets.AI_REQUEST_BINDING_HMAC_KEYS,
    )
    const signingPrivateKey = loadEd25519PrivateKey(
      runtimeSecrets.AI_ADMISSION_ED25519_PRIVATE_KEY_B64,
    )
    const tls = loadInternalMtlsMaterialFromBase64({
      ca: runtimeSecrets.AI_INTERNAL_MTLS_CA_B64,
      cert: runtimeSecrets.AI_INTERNAL_MTLS_CERT_B64,
      key: runtimeSecrets.AI_INTERNAL_MTLS_KEY_B64,
    })
    return {
      databaseTls,
      pool,
      requestBindingKeys,
      signingPrivateKey,
      tls,
    }
  })
pool.on('error', () => {
  process.stderr.write('ai_admission_db_idle_error\n')
})
assertAiRequestBindingKeyringInventory(requestBindingKeys, keyInventory)
assertAiAdmissionPrivateKeyInventory(
  { kid: signingKid, privateKey: signingPrivateKey },
  keyInventory,
)
const service = createAiExecutionAdmissionService({
  requestBindingKeys,
  signingKid,
  signingPrivateKey,
  database: createPostgresAiAdmissionAuthority({ pool, signingKid }),
})
const host = process.env.HOST ?? '::'
const port = portFromEnv()
const server = createInternalMtlsWebServer({
  host,
  port,
  tls,
  maxRequestBytes: AI_AUTHORIZE_MAX_BYTES,
  shutdownDrainTimeoutMs: AI_SERVICE_HANDLER_DRAIN_TIMEOUT_MILLIS_V1,
  resolvePeerIdentity: createExactSpiffePeerIdentityResolver({
    uri: GATEWAY_IDENTITY,
    dnsName: 'ai-egress-gateway',
    extendedKeyUsages: ['clientAuth', 'serverAuth'],
  }),
  handle: (request, peerIdentity) =>
    handleAiExecutionAdmissionRequest({
      request,
      peerIdentity,
      expectedGatewayIdentity: GATEWAY_IDENTITY,
      service,
    }),
})

if (!(await service.readiness())) {
  try {
    await pool.end()
  } finally {
    requestBindingKeys.dispose()
    databaseTls.dispose()
    tls.ca.fill(0)
    tls.cert.fill(0)
    tls.key.fill(0)
  }
  throw new Error('AI admission readiness verification failed')
}

server.listen(port, host)

const reaper = setInterval(() => {
  void service.reapExpired(100).catch(() => {
    process.stderr.write('ai_admission_reaper_error\n')
  })
}, 5 * 60_000)
reaper.unref()

let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(reaper)
  try {
    await server.stopAndDrain()
    await pool.end()
  } finally {
    requestBindingKeys.dispose()
    databaseTls.dispose()
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
