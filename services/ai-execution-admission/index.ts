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
import { createSidecarPlatformHealthServer } from '../platform-health'
import { registerSidecarOperationalLifecycle } from '../sidecar-operational-runtime'
import { unmonitoredSidecarObservability } from '../sidecar-unmonitored-observability'
import { resolveSidecarRuntimePorts } from '../sidecar-runtime-ports'

const GATEWAY_IDENTITY = 'spiffe://repkey.internal/ai-egress-gateway'
assertAiAdmissionRequiredEnvironment(process.env)
const keyInventory = resolveAiGatewayRuntimeKeyInventory(process.env)

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`required AI admission setting is missing: ${name}`)
  return value
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
pool.on('error', (error) => {
  unmonitoredSidecarObservability.capture(error, { source: 'sidecar-dependency' })
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
const readiness = async (signal: AbortSignal): Promise<boolean> => {
  if (signal.aborted) return false
  try {
    const ready = await service.readiness()
    return !signal.aborted && ready
  } catch {
    return false
  }
}
const host = process.env.HOST ?? '::'
const { healthPort, protectedMtlsPort } = resolveSidecarRuntimePorts(process.env)
const server = createInternalMtlsWebServer({
  host,
  port: protectedMtlsPort,
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
const platformHealth = createSidecarPlatformHealthServer({
  host,
  healthPort,
  protectedMtlsPort,
  readiness,
})

if (!(await readiness(AbortSignal.timeout(5_000)))) {
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

const reaper = setInterval(() => {
  void service.reapExpired(100).catch((error) => {
    unmonitoredSidecarObservability.capture(error, { source: 'sidecar-dependency' })
    process.stderr.write('ai_admission_reaper_error\n')
  })
}, 5 * 60_000)
reaper.unref()

let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(reaper)
  let failure: unknown
  try {
    await server.stopAndDrain()
  } catch (error) {
    failure = error
  }
  try {
    await pool.end()
  } catch (error) {
    failure ??= error
  }
  try {
    if (failure !== undefined) throw failure
  } finally {
    requestBindingKeys.dispose()
    databaseTls.dispose()
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
  service: 'ai-execution-admission',
  health: platformHealth,
  shutdown,
  shutdownTimeoutMs: 125_000,
  capture: unmonitoredSidecarObservability.capture,
  flush: unmonitoredSidecarObservability.flush,
})
