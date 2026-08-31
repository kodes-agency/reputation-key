import { createVersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import { createGoogleCredentialBinder } from '../../src/shared/google-provider-control/credential-binding'
import { createGoogleExecutionAdmissionHttpClient } from '../google-execution-admission/http-api'
import { createGoogleEgressGateway } from './service'
import { handleGoogleEgressGatewayRequest } from './http-api'
import {
  createInternalMtlsJsonTransport,
  createInternalMtlsWebServer,
  loadInternalMtlsMaterialFromOneSource,
} from '../internal-mtls'
import {
  assertGoogleEgressGatewayIdentity,
  createGoogleEgressPeerIdentityResolver,
  parseGoogleEgressCallerIdentities,
} from '../google-peer-identities'
import {
  assertGoogleGatewayRequiredLocalEnvironment,
  assertGoogleGatewayRequiredProductionEnvironment,
} from './environment'
import { createSidecarPlatformHealthServer } from '../platform-health'
import { registerSidecarOperationalLifecycle } from '../sidecar-operational-runtime'
import { monitoredSidecarObservability } from '../sidecar-monitored-observability'
import { resolveSidecarRuntimePorts } from '../sidecar-runtime-ports'

declare const __REPKEY_GOOGLE_LOCAL_SANDBOX__: boolean

if (__REPKEY_GOOGLE_LOCAL_SANDBOX__) {
  assertGoogleGatewayRequiredLocalEnvironment(process.env)
} else {
  assertGoogleGatewayRequiredProductionEnvironment(process.env)
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`required egress-gateway setting is missing: ${name}`)
  return value
}

function allowedCallerIdentities(): ReadonlySet<string> {
  return parseGoogleEgressCallerIdentities(
    requiredEnv('GOOGLE_EGRESS_ALLOWED_CALLER_IDENTITIES'),
  )
}

function routeTargetFromEnv() {
  const profile = requiredEnv('GOOGLE_PROVIDER_ROUTE_PROFILE')
  if (profile === 'production') return Object.freeze({ kind: 'production' as const })
  if (profile === 'local_sandbox' && __REPKEY_GOOGLE_LOCAL_SANDBOX__) {
    return Object.freeze({
      kind: 'local_sandbox' as const,
      simulatorOrigin: requiredEnv('GOOGLE_PROVIDER_SIMULATOR_ORIGIN'),
    })
  }
  throw new Error('egress-gateway route profile is invalid')
}

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
const admissionTransport = createInternalMtlsJsonTransport({
  origin: requiredEnv('GOOGLE_EXECUTION_ADMISSION_ORIGIN'),
  tls,
  serverName: requiredEnv('GOOGLE_EXECUTION_ADMISSION_SERVER_NAME'),
  peerIdentityPolicy: {
    uri: 'spiffe://repkey.internal/google-execution-admission',
    dnsName: requiredEnv('GOOGLE_EXECUTION_ADMISSION_SERVER_NAME'),
    extendedKeyUsages: ['serverAuth'],
  },
})
const admission = createGoogleExecutionAdmissionHttpClient(admissionTransport)
const grantKeyring = createVersionedHmacKeyring(
  requiredEnv('GOOGLE_ADMISSION_GRANT_HMAC_KEYS'),
)
const credentialKeyring = createVersionedHmacKeyring(
  requiredEnv('GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS'),
)
const gatewayIdentity = assertGoogleEgressGatewayIdentity(
  requiredEnv('GOOGLE_EGRESS_GATEWAY_IDENTITY'),
)
const callerIdentities = allowedCallerIdentities()
const routeTarget = routeTargetFromEnv()
const gateway = createGoogleEgressGateway({
  nowMs: Date.now,
  gatewayIdentity,
  bindCredential: createGoogleCredentialBinder(credentialKeyring),
  routeTarget,
  grantKeyring,
  admission,
  fetch,
})

const readiness = async (signal: AbortSignal): Promise<boolean> => {
  if (signal.aborted) return false
  try {
    const raw = await admissionTransport.get('/health/ready', { signal })
    return (
      !signal.aborted &&
      typeof raw === 'object' &&
      raw !== null &&
      (raw as Record<string, unknown>).ok === true
    )
  } catch {
    return false
  }
}

const host = process.env.HOST ?? '0.0.0.0'
const { healthPort, protectedMtlsPort } = resolveSidecarRuntimePorts(process.env)
const server = createInternalMtlsWebServer({
  host,
  port: protectedMtlsPort,
  tls,
  maxRequestBytes: 256 * 1024,
  resolvePeerIdentity: createGoogleEgressPeerIdentityResolver(),
  handle: (request, peerIdentity) =>
    handleGoogleEgressGatewayRequest({
      request,
      callerIdentity: peerIdentity,
      allowedCallerIdentities: callerIdentities,
      gateway,
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
  try {
    admissionTransport.close()
  } catch (error) {
    failure ??= error
  }
  try {
    if (failure !== undefined) throw failure
  } finally {
    grantKeyring.dispose()
    credentialKeyring.dispose()
    tls.ca.fill(0)
    tls.cert.fill(0)
    tls.key.fill(0)
  }
}

try {
  if (!(await readiness(AbortSignal.timeout(5_000)))) {
    throw new Error('Google egress-gateway dependencies are not ready')
  }
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
  service: 'google-egress-gateway',
  health: platformHealth,
  shutdown,
  shutdownTimeoutMs: 25_000,
  capture: monitoredSidecarObservability.capture,
  flush: monitoredSidecarObservability.flush,
})
