import {
  createExactSpiffePeerIdentityResolver,
  createInternalMtlsJsonTransport,
  createInternalMtlsWebServer,
  loadInternalMtlsMaterialFromBase64,
  type InternalPeerIdentityResolver,
} from '../internal-mtls'
import { createVersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import { createCld3ReplyLanguageDetector } from '../../src/shared/ai-reply-language-verifier'
import { AI_TREND_ROUTE_MAX_BYTES } from '../../src/shared/ai-internal-transport-contract'
import { AI_SERVICE_HANDLER_DRAIN_TIMEOUT_MILLIS_V1 } from '../../src/shared/ai-openai-provider-profile'
import {
  assertAiAdmissionPublicKeyringInventory,
  assertAiProvenancePrivateKeyInventory,
  assertAiRequestBindingKeyringInventory,
  resolveAiGatewayRuntimeKeyInventory,
} from '../../src/shared/ai-gateway-key-inventory'
import { createAiAdmissionClient } from './admission-client'
import { createAiGatewayRoutePreparer } from './route-preparer'
import {
  assertAiGatewayRequiredEnvironment,
  assertAiGatewayRuntimeKeyInventory,
} from './environment'
import { createAiEgressGatewayService } from './service'
import {
  handleAiEgressGatewayRequest,
  preflightAiEgressGatewayIncomingRequest,
} from './http-api'
import {
  loadEd25519PrivateKey,
  loadEd25519PublicKeyring,
  loadSafetyIdentifierKey,
} from './key-material'
import { createAiGatewayStagedCleanup } from './shutdown'
import { consumeAiGatewayRuntimeSecrets } from './runtime-secrets'
import type { OpenAiConnector } from './contracts'
import type { VersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import type { KeyObject } from 'node:crypto'

export type AiGatewayConnectorFactory = (
  input: Readonly<{
    apiKey: string
    requestBindingKeys: VersionedHmacKeyring
    admissionPublicKeys: ReadonlyMap<string, KeyObject>
  }>,
) => OpenAiConnector

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`required AI gateway setting is missing: ${name}`)
  return value
}

function portFromEnv(): number {
  const raw = process.env.PORT ?? '8443'
  if (!/^[0-9]+$/.test(raw)) throw new Error('AI gateway port is invalid')
  const port = Number(raw)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('AI gateway port is invalid')
  }
  return port
}

export async function startAiEgressGateway(
  createConnector: AiGatewayConnectorFactory,
): Promise<void> {
  let tls: ReturnType<typeof loadInternalMtlsMaterialFromBase64> | undefined
  let requestBindingKeys: VersionedHmacKeyring | undefined
  let safety: ReturnType<typeof loadSafetyIdentifierKey> | undefined
  let connector: OpenAiConnector | undefined
  let admissionTransport: ReturnType<typeof createInternalMtlsJsonTransport> | undefined
  let server: ReturnType<typeof createInternalMtlsWebServer> | undefined
  const shutdown = createAiGatewayStagedCleanup({
    server: () => server,
    asyncDisposables: () => {
      const resources = []
      if (admissionTransport !== undefined) resources.push(admissionTransport)
      if (connector !== undefined) resources.push(connector)
      return resources
    },
    sensitiveDisposables: () =>
      requestBindingKeys === undefined ? [] : [requestBindingKeys],
    sensitiveBuffers: () => {
      const buffers: Uint8Array[] = []
      if (safety !== undefined) buffers.push(safety.key)
      if (tls !== undefined) buffers.push(tls.ca, tls.cert, tls.key)
      return buffers
    },
  })

  try {
    assertAiGatewayRequiredEnvironment(process.env)
    const keyInventory = resolveAiGatewayRuntimeKeyInventory(process.env)
    const webPeer = createExactSpiffePeerIdentityResolver({
      uri: 'spiffe://repkey.internal/repkey-web',
      dnsName: null,
      extendedKeyUsages: ['clientAuth'],
    })
    const workerPeer = createExactSpiffePeerIdentityResolver({
      uri: 'spiffe://repkey.internal/repkey-worker',
      dnsName: null,
      extendedKeyUsages: ['clientAuth'],
    })
    const resolvePeerIdentity: InternalPeerIdentityResolver = (certificate) =>
      webPeer(certificate) ?? workerPeer(certificate)

    const derived = consumeAiGatewayRuntimeSecrets(process.env, (runtimeSecrets) => {
      tls = loadInternalMtlsMaterialFromBase64({
        ca: runtimeSecrets.AI_INTERNAL_MTLS_CA_B64,
        cert: runtimeSecrets.AI_INTERNAL_MTLS_CERT_B64,
        key: runtimeSecrets.AI_INTERNAL_MTLS_KEY_B64,
      })
      requestBindingKeys = createVersionedHmacKeyring(
        runtimeSecrets.AI_REQUEST_BINDING_HMAC_KEYS,
      )
      safety = loadSafetyIdentifierKey(runtimeSecrets.AI_SAFETY_IDENTIFIER_HMAC_KEYS)
      const admissionPublicKeys = loadEd25519PublicKeyring(
        runtimeSecrets.AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON,
      )
      const provenancePrivateKey = loadEd25519PrivateKey(
        runtimeSecrets.AI_PROVENANCE_ED25519_PRIVATE_KEY_B64,
      )
      connector = createConnector({
        apiKey: runtimeSecrets.OPENAI_API_KEY,
        requestBindingKeys,
        admissionPublicKeys,
      })
      return {
        admissionPublicKeys,
        provenancePrivateKey,
      }
    })
    if (
      tls === undefined ||
      requestBindingKeys === undefined ||
      safety === undefined ||
      connector === undefined
    ) {
      throw new Error('AI gateway secret construction failed')
    }
    admissionTransport = createInternalMtlsJsonTransport({
      origin: requiredEnv('AI_EXECUTION_ADMISSION_ORIGIN'),
      tls,
      serverName: 'ai-execution-admission',
      peerIdentityPolicy: {
        uri: 'spiffe://repkey.internal/ai-execution-admission',
        dnsName: 'ai-execution-admission',
        extendedKeyUsages: ['serverAuth'],
      },
      timeoutMs: 115_000,
    })
    const admission = createAiAdmissionClient(admissionTransport)
    assertAiRequestBindingKeyringInventory(requestBindingKeys, keyInventory)
    assertAiGatewayRuntimeKeyInventory({
      safetyIdentifierVersion: safety.version,
      provenanceKid: requiredEnv('AI_PROVENANCE_ED25519_KID'),
    })
    assertAiAdmissionPublicKeyringInventory(derived.admissionPublicKeys, keyInventory)
    const provenanceKid = requiredEnv('AI_PROVENANCE_ED25519_KID')
    assertAiProvenancePrivateKeyInventory(
      {
        kid: provenanceKid,
        privateKey: derived.provenancePrivateKey,
      },
      keyInventory,
    )
    const replyLanguageDetector = await createCld3ReplyLanguageDetector()
    const preparer = createAiGatewayRoutePreparer({
      requestBindingKeys,
      safetyIdentifierKey: safety.key,
      replyLanguageDetector,
      provenanceKid,
      provenancePrivateKey: derived.provenancePrivateKey,
    })
    const service = createAiEgressGatewayService({
      admission,
      connector,
      preparer,
      admissionPublicKeys: derived.admissionPublicKeys,
    })
    const host = process.env.HOST ?? '::'
    const port = portFromEnv()
    server = createInternalMtlsWebServer({
      host,
      port,
      tls,
      maxRequestBytes: AI_TREND_ROUTE_MAX_BYTES,
      resolvePeerIdentity,
      streamRequestBody: true,
      shutdownDrainTimeoutMs: AI_SERVICE_HANDLER_DRAIN_TIMEOUT_MILLIS_V1,
      preflight: preflightAiEgressGatewayIncomingRequest,
      handle: (request, peerIdentity) =>
        handleAiEgressGatewayRequest({ request, peerIdentity, service }),
    })
    if (!(await service.readiness(AbortSignal.timeout(5_000)))) {
      throw new Error('AI gateway startup readiness failed')
    }
    server.listen(port, host)
    // This service emitted nothing at all — not one line — which meant a silent
    // no_dispatch on the critical route was indistinguishable from a service that
    // was never reached. One bounded line per boot: what is serving, and the
    // contract identities it will enforce. No secrets; digests are public
    // contract identifiers.
    process.stderr.write(
      `${JSON.stringify({
        event: 'gateway_listening',
        port,
        releaseSha: process.env.RELEASE_SHA ?? null,
        runtimeCapabilityCatalogueDigest:
          process.env.AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST ?? null,
        providerDeploymentProfileVersion:
          process.env.AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION ?? null,
      })}\n`,
    )
    process.once('SIGTERM', () => {
      void shutdown().finally(() => process.exit(0))
    })
    process.once('SIGINT', () => {
      void shutdown().finally(() => process.exit(0))
    })
  } catch (error) {
    try {
      await shutdown()
    } catch {
      // Preserve the construction/readiness error after best-effort destruction.
    }
    throw error
  }
}
