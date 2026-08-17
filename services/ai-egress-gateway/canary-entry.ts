import { z } from 'zod'
import {
  createInternalMtlsJsonTransport,
  loadInternalMtlsMaterialFromBase64,
} from '../internal-mtls'
import { createVersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import { createAiAdmissionClient } from './admission-client'
import { createAiOneShotCanary } from './canary'
import { assertAiCanaryRequiredEnvironment } from './environment'
import { loadEd25519PublicKeyring } from './key-material'
import { createOpenAiConnector } from './openai-connector'
import { consumeAiCanaryRuntimeSecrets } from './runtime-secrets'
import { parseStrictInternalJsonBytes } from '../../src/shared/ai-internal-transport-contract'
import {
  assertAiAdmissionPublicKeyringInventory,
  assertAiRequestBindingKeyringInventory,
  resolveAiGatewayRuntimeKeyInventory,
} from '../../src/shared/ai-gateway-key-inventory'

const canonicalUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
const positiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const capabilityStopFence = z
  .object({
    capability: z.enum(['review_analysis', 'reply_drafting', 'property_trends']),
    capabilityControlId: canonicalUuid,
    capabilityGeneration: positiveSafeInteger,
  })
  .strict()
const canaryClaimSchema = z
  .object({
    operationId: canonicalUuid,
    permitId: canonicalUuid,
    attemptNumber: z.literal(1),
    deadlineEpochMillis: positiveSafeInteger,
    binding: z
      .object({
        canaryAuthorizationId: canonicalUuid,
        canaryAuthorizationGeneration: z.number().int().min(1).max(3),
        releaseSha: z.string().regex(/^[0-9a-f]{40}$/u),
        canaryProfileVersion: z.literal('synthetic-canary-v1'),
        safetyIdentifierProfileVersion: z.literal('synthetic-canary-safety-v1'),
        providerDeploymentProfileVersion: z.literal('private-beta-global-v1'),
        operationProfileVersion: z.literal('synthetic-canary-v1'),
        stopFence: z
          .object({
            globalControlId: canonicalUuid,
            globalGeneration: positiveSafeInteger,
            providerControlId: canonicalUuid,
            providerGeneration: positiveSafeInteger,
            allCapabilityStopFences: z.tuple([
              capabilityStopFence.extend({ capability: z.literal('review_analysis') }),
              capabilityStopFence.extend({ capability: z.literal('reply_drafting') }),
              capabilityStopFence.extend({ capability: z.literal('property_trends') }),
            ]),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`required AI gateway setting is missing: ${name}`)
  return value
}

async function readBoundedStdin(limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let byteLength = 0
  try {
    for await (const raw of process.stdin) {
      const bytes = Buffer.from(raw)
      if (raw instanceof Uint8Array) raw.fill(0)
      byteLength += bytes.byteLength
      if (byteLength > limit) {
        bytes.fill(0)
        throw new Error('AI canary claim exceeds its byte limit')
      }
      chunks.push(bytes)
    }
    const body = Buffer.concat(chunks, byteLength)
    for (const owned of chunks) owned.fill(0)
    chunks.length = 0
    return body
  } catch {
    for (const owned of chunks) owned.fill(0)
    chunks.length = 0
    throw new Error('AI canary claim is invalid')
  }
}

async function main(): Promise<void> {
  assertAiCanaryRequiredEnvironment(process.env)
  const keyInventory = resolveAiGatewayRuntimeKeyInventory(process.env)
  const releaseSha = requiredEnv('RELEASE_SHA')
  let tls: ReturnType<typeof loadInternalMtlsMaterialFromBase64> | undefined
  let admissionTransport: ReturnType<typeof createInternalMtlsJsonTransport> | undefined
  let requestBindingKeys: ReturnType<typeof createVersionedHmacKeyring> | undefined
  let claimBytes: Buffer | undefined
  let connector: ReturnType<typeof createOpenAiConnector> | undefined
  let cleanupFailure: unknown = null
  try {
    const derived = consumeAiCanaryRuntimeSecrets(process.env, (runtimeSecrets) => {
      tls = loadInternalMtlsMaterialFromBase64({
        ca: runtimeSecrets.AI_INTERNAL_MTLS_CA_B64,
        cert: runtimeSecrets.AI_INTERNAL_MTLS_CERT_B64,
        key: runtimeSecrets.AI_INTERNAL_MTLS_KEY_B64,
      })
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
      requestBindingKeys = createVersionedHmacKeyring(
        runtimeSecrets.AI_REQUEST_BINDING_HMAC_KEYS,
      )
      const admissionPublicKeys = loadEd25519PublicKeyring(
        runtimeSecrets.AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON,
      )
      connector = createOpenAiConnector({
        apiKey: runtimeSecrets.OPENAI_API_KEY,
        requestBindingKeys,
        admissionPublicKeys,
      })
      return { admissionPublicKeys }
    })
    if (
      tls === undefined ||
      admissionTransport === undefined ||
      requestBindingKeys === undefined ||
      connector === undefined
    ) {
      throw new Error('AI canary secret construction failed')
    }
    assertAiRequestBindingKeyringInventory(requestBindingKeys, keyInventory)
    assertAiAdmissionPublicKeyringInventory(derived.admissionPublicKeys, keyInventory)
    const canary = createAiOneShotCanary({
      admission: createAiAdmissionClient(admissionTransport),
      connector,
      requestBindingKeys,
      admissionPublicKeys: derived.admissionPublicKeys,
      releaseSha,
    })
    claimBytes = await readBoundedStdin(65_536)
    const claim = parseStrictInternalJsonBytes(claimBytes, 65_536, canaryClaimSchema)
    const result = await canary.run(claim, AbortSignal.timeout(100_000))
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (result.status !== 'passed') process.exitCode = 1
  } finally {
    claimBytes?.fill(0)
    try {
      await admissionTransport?.close()
    } catch (error) {
      cleanupFailure = error
    }
    try {
      await connector?.close?.()
    } catch (error) {
      cleanupFailure ??= error
      try {
        connector?.destroy?.()
      } catch (destroyError) {
        cleanupFailure ??= destroyError
      }
    }
    try {
      requestBindingKeys?.dispose()
    } catch (error) {
      cleanupFailure ??= error
    }
    for (const buffer of tls === undefined ? [] : [tls.ca, tls.cert, tls.key]) {
      try {
        buffer.fill(0)
      } catch (error) {
        cleanupFailure ??= error
      }
    }
  }
  if (cleanupFailure !== null) throw cleanupFailure
}

await main().catch(() => {
  process.stderr.write('AI synthetic canary failed\n')
  process.exitCode = 1
})
