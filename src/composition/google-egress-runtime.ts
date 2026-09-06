// Composition — the Google egress runtime, in this process.
//
// WP2.1. Google provider calls used to leave this process twice before they
// reached Google: once over mTLS to a `google-execution-admission` sidecar that
// decided whether the call was permitted, and once over mTLS to a
// `google-egress-gateway` sidecar that made it. Both sidecars were the same two
// factories this module now constructs — `createGoogleExecutionAdmissionService`
// and `createGoogleEgressGateway` — wrapped in a bootstrap, an environment
// scrubber, an mTLS server and a health server.
//
// WHY COLLAPSE THEM. The split bought process isolation between the code that
// decides and the code that calls, and paid for it with two container images,
// two Dockerfiles, two tsup configs, six Compose services, a private CA with
// six mTLS variables, a peer-identity policy, and an HMAC grant handshake whose
// only job was to let two processes agree on a decision they had both already
// computed. For one organization and six properties that is not a security
// boundary anyone can operate; it is a distributed system built to protect a
// function call. The decision and the call now happen in one process, in this
// order, with the same code.
//
// WHAT DOES NOT CHANGE. Quota and in-flight coordination stay in Redis, because
// Google's per-project quota is shared by the web and worker processes and
// genuinely needs a coordination point outside either of them. The permit
// authority stays in Postgres for now; it loses its only remaining purpose in
// WP2.2, when the approval ceremony that writes those rows is deleted.

import { randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { createGoogleCredentialBinder } from '#/shared/google-provider-control/credential-binding'
import { createRedisGoogleAdmissionGrantStore } from '#/shared/google-provider-control/admission-grant-store'
import type { GoogleAdmissionGrantRedis } from '#/shared/google-provider-control/admission-grant-store'
import {
  GOOGLE_QUOTA_POLICIES,
  createRedisGoogleInFlightCoordinator,
  createRedisGoogleQuotaCoordinator,
  type GoogleCoordinationRedis,
} from '#/shared/google-provider-control/quota-coordinator'
import type {
  GoogleInFlightCoordinator,
  GoogleQuotaCoordinator,
} from '#/shared/google-provider-control/contracts'
import { createPostgresGoogleAdmissionPermitAuthority } from '#/shared/google-provider-control/postgres-permit-authority'
import { createGoogleExecutionAdmissionService } from '#/shared/google-provider-control/admission-service'
import {
  createGoogleEgressGateway,
  type GoogleEgressGateway,
} from '#/shared/google-provider-control/egress-gateway'
import type { GoogleProviderRouteTarget } from '#/shared/google-provider-control/route-catalogue'

/**
 * The Redis this runtime coordinates through. Both the grant store and the
 * quota/in-flight coordinators narrow `ioredis` to the commands they use, so
 * the intersection is what a caller has to supply.
 */
export type GoogleEgressCoordinationRedis = GoogleAdmissionGrantRedis &
  GoogleCoordinationRedis

export type InProcessGoogleEgressRuntime = Readonly<{
  gateway: GoogleEgressGateway
  bindCredential: (credential: string) => string
}>

export function createInProcessGoogleEgressRuntime(
  deps: Readonly<{
    pool: Pool
    redis: GoogleEgressCoordinationRedis
    nowMs: () => number
    gatewayIdentity: string
    releaseSha: string
    credentialBindingKeys: string
    grantKeys: string
    routeTarget?: GoogleProviderRouteTarget
    logger: Readonly<{
      warn: (fields: Readonly<Record<string, unknown>>, message: string) => void
    }>
  }>,
): InProcessGoogleEgressRuntime {
  const quotaCoordinators = new Map<string, GoogleQuotaCoordinator>()
  const inFlightCoordinators = new Map<string, GoogleInFlightCoordinator>()
  for (const [policyId, policy] of Object.entries(GOOGLE_QUOTA_POLICIES)) {
    quotaCoordinators.set(
      policyId,
      createRedisGoogleQuotaCoordinator({
        redis: deps.redis,
        nowMs: deps.nowMs,
        policyId,
        policy,
      }),
    )
    inFlightCoordinators.set(
      policyId,
      createRedisGoogleInFlightCoordinator({
        redis: deps.redis,
        nowMs: deps.nowMs,
        leaseId: () => randomBytes(24).toString('base64url'),
        policyId,
        policy,
      }),
    )
  }

  // One keyring, shared. In the split topology the gateway and the admission
  // service each built their own from the same secret so the grant one signed
  // verified against the other; in one process that is the same object.
  const grantKeyring = createVersionedHmacKeyring(deps.grantKeys)

  const admission = createGoogleExecutionAdmissionService({
    nowMs: deps.nowMs,
    admissionId: () => randomBytes(24).toString('base64url'),
    grantKeyring,
    grantStore: createRedisGoogleAdmissionGrantStore(deps.redis, deps.nowMs),
    authority: createPostgresGoogleAdmissionPermitAuthority({
      pool: deps.pool,
      gatewayIdentity: deps.gatewayIdentity,
      releaseSha: deps.releaseSha,
    }),
    quotaForPolicy: (policyId) => quotaCoordinators.get(policyId) ?? null,
    inFlightForPolicy: (policyId) => inFlightCoordinators.get(policyId) ?? null,
  })

  const bindCredential = createGoogleCredentialBinder(
    createVersionedHmacKeyring(deps.credentialBindingKeys),
  )

  return Object.freeze({
    bindCredential,
    gateway: createGoogleEgressGateway({
      nowMs: deps.nowMs,
      gatewayIdentity: deps.gatewayIdentity,
      bindCredential,
      routeTarget: deps.routeTarget,
      grantKeyring,
      admission,
      fetch,
      logger: deps.logger,
    }),
  })
}
