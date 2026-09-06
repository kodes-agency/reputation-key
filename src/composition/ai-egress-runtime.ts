// Composition — the AI egress runtime, in this process.
//
// WP2.3. AI provider calls used to leave this process twice before they reached
// OpenAI: once over mTLS to an `ai-execution-admission` sidecar that decided
// whether the call was permitted and signed a grant, and once over mTLS to an
// `ai-egress-gateway` sidecar that made the call and settled the permit. Both
// sidecars were the factories this module now constructs —
// `createAiExecutionAdmissionService` and `createAiEgressGatewayService` —
// wrapped in a bootstrap, an environment scrubber, a runtime-secret consumer,
// an mTLS server, a health server and a staged shutdown.
//
// WHY COLLAPSE THEM. Identical reasoning to WP2.1's Google collapse, which this
// mirrors deliberately: the split bought process isolation between the code
// that decides and the code that calls, and paid for it with two container
// images, two Dockerfiles, two tsup configs, three Compose services, a private
// CA with five mTLS variables, two SPIFFE identities, a separate Postgres role
// on a separate connection with its own TLS module, and an Ed25519 grant
// handshake whose job was to let two processes agree on a decision they had both
// already computed. For one organization and six properties that is not a
// security boundary anyone can operate.
//
// WHERE THE KEY LIVES NOW, and why that is not a regression. `OPENAI_API_KEY` is
// in this process, web included. Settled by the owner on 2026-09-06 against the
// evidence: this process already holds `ENCRYPTION_KEY`, which decrypts every
// merchant's stored Google OAuth access and refresh tokens, and
// `GOOGLE_CLIENT_SECRET` (`server/plugins/production-secret-guard.ts:21`,
// `shared/config/production-secrets.ts`). A compromise here already yields
// strictly more than an OpenAI key. The genuine asymmetry is that the key is a
// SPEND authority, and the control that bounds spend — `route-preparer.ts`, with
// its per-route cost ceiling, request binding, safety identifier and provenance
// signing — survives this collapse untouched and is still the only path to the
// provider.
//
// WHAT DOES NOT CHANGE. The admission decision is still a Postgres state
// machine (`admit_ai_property_v1`), so at-most-once per grant still holds across
// web and worker; it simply runs on this process's own pool instead of a second
// connection as a second role. The settlement receipt is still signed and
// verified — it stops being load-bearing once no reply crosses a wire, but
// removing it touches both service bodies and their orchestration tests, so it
// is a separate step rather than a passenger on this one.

import type { KeyObject } from 'node:crypto'
import type { Pool } from 'pg'
import type { Env } from '#/shared/config/env'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { createCld3ReplyLanguageDetector } from '#/shared/ai-reply-language-verifier'
import {
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
import { createPostgresAiAdmissionAuthority } from '#/shared/ai-provider-control/postgres-admission-authority'
import { createAiGatewayRoutePreparer } from '#/shared/ai-provider-control/route-preparer'
import { createOpenAiConnector } from '#/shared/ai-provider-control/openai-connector'
import { createLocalAiProviderFetch } from '#/shared/ai-provider-control/local-provider-fetch'
import {
  loadEd25519PrivateKey,
  loadEd25519PublicKeyring,
  loadSafetyIdentifierKey,
} from '#/shared/ai-provider-control/key-material'
import type { AiAdmissionClient } from '#/shared/ai-provider-control/contracts'

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
    settle: async (request) => {
      const result = await service.settle(request)
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
    runtimeEnvironment: Readonly<Record<string, string | undefined>>
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

    // The admission authority is the same Postgres state machine the sidecar
    // called; it just runs on this process's pool. `signingKid` is passed to the
    // SQL because the receipt is signed inside the transaction that records the
    // settlement, which is what made the receipt trustworthy across the wire.
    const admission = inProcessAdmissionClient(
      createAiExecutionAdmissionService({
        requestBindingKeys,
        signingKid: admissionKid,
        signingPrivateKey: admissionPrivateKey,
        database: createPostgresAiAdmissionAuthority({
          pool: input.pool,
          signingKid: admissionKid,
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

    const preparer = createAiGatewayRoutePreparer({
      requestBindingKeys,
      safetyIdentifierKey: safety.key,
      replyLanguageDetector: await createCld3ReplyLanguageDetector(),
      provenanceKid,
      provenancePrivateKey,
    })

    return createAiEgressGatewayService({
      admission,
      connector,
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
