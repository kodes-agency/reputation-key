// The gateway and admission authority run in process. PostgreSQL owns permits
// and budget settlement; the gateway releases output only after settlement.

import type { KeyObject } from 'node:crypto'
import type { Pool } from 'pg'
import type { Env } from '#/shared/config/env'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { createCld3ReplyLanguageDetector } from '#/shared/ai-reply-language-verifier'
import {
  assertAiAdmissionPrivateKeyInventory,
  assertAiAdmissionPublicKeyringInventory,
  assertAiProvenancePrivateKeyInventory,
  assertAiRequestBindingKeyringInventory,
  resolveAiGatewayRuntimeKeyInventory,
} from '#/shared/ai-gateway-key-inventory'
import {
  createAiEgressGatewayService,
  type AiEgressGatewayService,
} from '#/shared/ai-provider-control/service'
import {
  createAiExecutionAdmissionService,
  type AiExecutionAdmissionService,
} from '#/shared/ai-provider-control/admission-service'
import { createAiExecutionAdmissionAdapter } from '#/contexts/ai/infrastructure/adapters/ai-execution-admission.adapter'
import { createAiGatewayRoutePreparer } from '#/shared/ai-provider-control/route-preparer'
import { createOpenAiConnector } from '#/shared/ai-provider-control/openai-connector'
import { createOpenAiProviderAdapter } from '#/shared/ai-provider-control/openai-provider-adapter'
import {
  createAiProviderRegistry,
  type AiProviderSelectionConfig,
} from '#/shared/ai-provider-control/provider-selection'
import { OPERATOR_PROVIDER_SELECTION } from '#/shared/ai-provider-control/operator-provider-selection'
import { createLocalAiProviderFetch } from '#/shared/ai-provider-control/local-provider-fetch'
import {
  loadEd25519PrivateKey,
  loadEd25519PublicKeyring,
  loadSafetyIdentifierKey,
} from '#/shared/ai-provider-control/key-material'
import type { AiAdmissionClient } from '#/shared/ai-provider-control/contracts'
import { getLogger } from '#/shared/observability/logger'

/**
 * The sidecar pair exposed a health endpoint and a readiness probe because a
 * container orchestrator needed to know whether to route to them. In-process
 * there is nothing to route: readiness is construction succeeding.
 */
export type AiEgressRuntime = Readonly<{
  service(): Promise<AiEgressGatewayService>
}>

/**
 * The admission service decides synchronously against the database; the gateway
 * expects the client shape the mTLS transport used to present. The two differ
 * only in the discriminant name and an ignored `signal` — the wire's cancellation
 * had a socket to abort, a function call does not.
 */
function inProcessAdmissionClient(
  service: AiExecutionAdmissionService,
): AiAdmissionClient {
  return Object.freeze({
    authorize: async (request) => {
      const result = await service.authorize(request)
      return result.ok
        ? Object.freeze({ status: 'authorized' as const, grant: result.grant })
        : Object.freeze({ status: 'denied' as const, code: result.code })
    },
    settle: async (permit, outcome) => {
      const result = await service.settle(permit, outcome)
      return result.ok
        ? Object.freeze({ status: 'settled' as const, receipt: result.receipt })
        : Object.freeze({ status: 'denied' as const, code: result.code })
    },
    // Over mTLS this probed a socket, because the admission service could be
    // unreachable while this process was healthy. A function call in this
    // process cannot be: if construction succeeded, admission is callable, and
    // whether the DATABASE is reachable is the pool's answer to give on the
    // call itself rather than a second liveness opinion cached here.
    readiness: async () => true,
  })
}

function requireEnv(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required to run AI provider calls in this process`)
  }
  return value
}

/**
 * Refuse the local provider stub anywhere it could reach a real merchant.
 *
 * Two conjuncts, mirroring the owner ruling recorded at `provider-runtime.ts:97`
 * for the Google local-sandbox denial. `NODE_ENV` alone cannot decide this: the
 * Compose stack rehearses the production images and therefore sets
 * `NODE_ENV=production`. `RELEASE_MANIFEST_SHA256` is a promotion digest
 * installed as a service variable and never set by Compose, so it identifies a
 * deployed cell. The second conjunct covers that digest's documented dark window
 * — it is optional in the schema, so a not-yet-promoted cell would otherwise run
 * this denial blind — by additionally requiring the explicit rehearsal selector
 * that Compose sets for every application process.
 */
function assertLocalProviderOriginAllowed(env: Env): void {
  if (env.AI_PROVIDER_LOCAL_STUB === undefined) return
  const deployedCell = env.RELEASE_MANIFEST_SHA256 !== undefined
  const rehearsal = env.GOOGLE_PROVIDER_ENDPOINT_PROFILE === 'local-sandbox'
  if (deployedCell || (env.NODE_ENV === 'production' && !rehearsal)) {
    throw new Error(
      'AI_PROVIDER_LOCAL_STUB is unavailable in a deployed cell — it would send ' +
        'the provider key and merchant content to a stub',
    )
  }
}

/**
 * Construct the two collapsed services, lazily.
 *
 * Lazy because the reply language detector loads a CLD3 model asynchronously and
 * `createContainer` is synchronous. Paying that on the first AI call rather than
 * on every boot also keeps a process that never makes one — which is most of
 * them — from loading the model at all. Memoized on the promise, so concurrent
 * first calls share one construction and a failed construction is not cached.
 */
export function createAiEgressRuntime(
  input: Readonly<{
    env: Env
    pool: Pool
    clock: () => Date
    runtimeEnvironment: Readonly<Record<string, string | undefined>>
    /**
     * The operator's choice of provider per capability (contract section 7.3). It
     * only matters to a profile attested for more than one provider, which is review
     * analysis v3. Left out, it is `OPERATOR_PROVIDER_SELECTION`, which names OpenAI
     * alone: a construction that forgot the choice must not leave review analysis
     * waiting for one, and no construction names another provider but a test.
     */
    providerSelection?: AiProviderSelectionConfig
  }>,
): AiEgressRuntime {
  assertLocalProviderOriginAllowed(input.env)
  let pending: Promise<AiEgressGatewayService> | null = null

  const construct = async (): Promise<AiEgressGatewayService> => {
    const env = input.env
    const keyInventory = resolveAiGatewayRuntimeKeyInventory({
      ...input.runtimeEnvironment,
      AI_KEY_INVENTORY_PROFILE: env.AI_KEY_INVENTORY_PROFILE,
    })

    const requestBindingKeys = createVersionedHmacKeyring(
      requireEnv(env.AI_REQUEST_BINDING_HMAC_KEYS, 'AI_REQUEST_BINDING_HMAC_KEYS'),
    )
    assertAiRequestBindingKeyringInventory(requestBindingKeys, keyInventory)

    const safety = loadSafetyIdentifierKey(
      requireEnv(env.AI_SAFETY_IDENTIFIER_HMAC_KEYS, 'AI_SAFETY_IDENTIFIER_HMAC_KEYS'),
    )

    const admissionPublicKeys: ReadonlyMap<string, KeyObject> = loadEd25519PublicKeyring(
      requireEnv(
        env.AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON,
        'AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON',
      ),
    )
    assertAiAdmissionPublicKeyringInventory(admissionPublicKeys, keyInventory)

    const admissionKid = requireEnv(
      env.AI_ADMISSION_ED25519_KID,
      'AI_ADMISSION_ED25519_KID',
    )
    const admissionPrivateKey = loadEd25519PrivateKey(
      requireEnv(
        env.AI_ADMISSION_ED25519_PRIVATE_KEY_B64,
        'AI_ADMISSION_ED25519_PRIVATE_KEY_B64',
      ),
    )
    // The public keyring above is pinned; this pins the key that signs. A
    // private key that does not pair with it signs grants that the gateway then
    // fails to verify, after the database has admitted the operation and
    // reserved its budget, and the operation answers `operation_ambiguous`.
    assertAiAdmissionPrivateKeyInventory(
      { kid: admissionKid, privateKey: admissionPrivateKey },
      keyInventory,
    )

    const provenanceKid = requireEnv(
      env.AI_PROVENANCE_ED25519_KID,
      'AI_PROVENANCE_ED25519_KID',
    )
    const provenancePrivateKey = loadEd25519PrivateKey(
      requireEnv(
        env.AI_PROVENANCE_ED25519_PRIVATE_KEY_B64,
        'AI_PROVENANCE_ED25519_PRIVATE_KEY_B64',
      ),
    )
    assertAiProvenancePrivateKeyInventory(
      { kid: provenanceKid, privateKey: provenancePrivateKey },
      keyInventory,
    )

    const admission = inProcessAdmissionClient(
      createAiExecutionAdmissionService({
        requestBindingKeys,
        signingKid: admissionKid,
        signingPrivateKey: admissionPrivateKey,
        database: createAiExecutionAdmissionAdapter({
          pool: input.pool,
          signingKid: admissionKid,
          now: input.clock,
        }),
      }),
    )

    const connector = createOpenAiConnector({
      apiKey: requireEnv(env.OPENAI_API_KEY, 'OPENAI_API_KEY'),
      requestBindingKeys,
      admissionPublicKeys,
      // Unset in production, where the connector pins its own outbound path to
      // api.openai.com. The guard above is what keeps it unset there.
      ...(env.AI_PROVIDER_LOCAL_STUB === undefined
        ? {}
        : { outboundFetch: createLocalAiProviderFetch() }),
    })

    // One adapter per provider the process can call. The same registry shapes the
    // request and makes the call, so a provider that prepared a request is the only
    // one that sends it.
    const providers = createAiProviderRegistry(
      [createOpenAiProviderAdapter(connector)],
      input.providerSelection ?? OPERATOR_PROVIDER_SELECTION,
    )

    const preparer = createAiGatewayRoutePreparer({
      providers,
      requestBindingKeys,
      safetyIdentifierKey: safety.key,
      replyLanguageDetector: await createCld3ReplyLanguageDetector(),
      provenanceKid,
      provenancePrivateKey,
      // The operation row only ever records `output_invalid`, so without this
      // line a refused draft cannot be attributed to one of eight rules after
      // the fact - which is exactly the diagnosis that previously needed a
      // probe attached to the running process. Identifiers only.
      onOutputRefused: (refusal) => {
        getLogger().warn(refusal, 'AI reply output refused by an output rule')
      },
    })

    return createAiEgressGatewayService({
      admission,
      providers,
      preparer,
      admissionPublicKeys,
    })
  }

  return Object.freeze({
    service: () => {
      pending ??= construct().catch((error: unknown) => {
        pending = null
        throw error
      })
      return pending
    },
  })
}
