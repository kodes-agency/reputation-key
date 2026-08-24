import { createVersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import { createGoogleCredentialBinder } from '../../src/shared/google-provider-control/credential-binding'
import { createGoogleExecutionAdmissionHttpClient } from '../google-execution-admission/http-api'
import { createGoogleEgressGateway } from './service'
import { handleGoogleEgressGatewayRequest } from './http-api'
import {
  createInternalMtlsJsonTransport,
  createInternalMtlsWebServer,
  loadInternalMtlsMaterial,
} from '../internal-mtls'
import {
  assertGoogleEgressGatewayIdentity,
  createGoogleEgressPeerIdentityResolver,
  parseGoogleEgressCallerIdentities,
} from '../google-peer-identities'

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`required egress-gateway setting is missing: ${name}`)
  return value
}

function portFromEnv(): number {
  const raw = process.env.PORT ?? '8443'
  if (!/^[0-9]+$/.test(raw)) throw new Error('egress-gateway port is invalid')
  const port = Number(raw)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('egress-gateway port is invalid')
  }
  return port
}

function allowedCallerIdentities(): ReadonlySet<string> {
  return parseGoogleEgressCallerIdentities(
    requiredEnv('GOOGLE_EGRESS_ALLOWED_CALLER_IDENTITIES'),
  )
}

function routeTargetFromEnv() {
  const profile = requiredEnv('GOOGLE_PROVIDER_ROUTE_PROFILE')
  if (profile === 'production') return Object.freeze({ kind: 'production' as const })
  if (profile === 'local_sandbox') {
    return Object.freeze({
      kind: 'local_sandbox' as const,
      simulatorOrigin: requiredEnv('GOOGLE_PROVIDER_SIMULATOR_ORIGIN'),
    })
  }
  throw new Error('egress-gateway route profile is invalid')
}

const tls = loadInternalMtlsMaterial({
  caPath: requiredEnv('GOOGLE_INTERNAL_MTLS_CA_PATH'),
  certPath: requiredEnv('GOOGLE_INTERNAL_MTLS_CERT_PATH'),
  keyPath: requiredEnv('GOOGLE_INTERNAL_MTLS_KEY_PATH'),
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

const server = createInternalMtlsWebServer({
  host: process.env.HOST ?? '0.0.0.0',
  port: portFromEnv(),
  tls,
  maxRequestBytes: 256 * 1024,
  resolvePeerIdentity: createGoogleEgressPeerIdentityResolver(),
  handle: (request, peerIdentity) =>
    handleGoogleEgressGatewayRequest({
      request,
      callerIdentity: peerIdentity,
      allowedCallerIdentities: callerIdentities,
      gateway,
      readiness: async () => {
        try {
          const raw = await admissionTransport.get('/health/ready')
          return (
            typeof raw === 'object' &&
            raw !== null &&
            (raw as Record<string, unknown>).ok === true
          )
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
  const closed = Promise.withResolvers<void>()
  server.close(() => closed.resolve())
  await closed.promise
}

process.once('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0))
})
process.once('SIGINT', () => {
  void shutdown().finally(() => process.exit(0))
})
