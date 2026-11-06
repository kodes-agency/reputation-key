import { randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { createGoogleCredentialBinder } from '#/shared/google-provider-control/credential-binding'
import {
  createGoogleCoordinationLookup,
  type GoogleCoordinationRedis,
} from '#/shared/google-provider-control/quota-coordinator'
import { createPostgresGoogleAdmissionPermitAuthority } from '#/shared/google-provider-control/postgres-permit-authority'
import { createGoogleExecutionAdmissionService } from '#/shared/google-provider-control/admission-service'
import {
  createGoogleEgressGateway,
  type GoogleEgressGateway,
} from '#/shared/google-provider-control/egress-gateway'
import type { GoogleProviderRouteTarget } from '#/shared/google-provider-control/route-catalogue'

/** Redis remains shared across web and worker for quota and in-flight limits. */
export type GoogleEgressCoordinationRedis = GoogleCoordinationRedis

export type InProcessGoogleEgressRuntime = Readonly<{
  gateway: GoogleEgressGateway
  bindCredential: (credential: string) => string
}>

export function createInProcessGoogleEgressRuntime(
  deps: Readonly<{
    pool: Pool
    redis: GoogleEgressCoordinationRedis
    nowMs: () => number
    credentialBindingKeys: string
    routeTarget?: GoogleProviderRouteTarget
    logger: Readonly<{
      warn: (fields: Readonly<Record<string, unknown>>, message: string) => void
    }>
  }>,
): InProcessGoogleEgressRuntime {
  const coordination = createGoogleCoordinationLookup({
    redis: deps.redis,
    nowMs: deps.nowMs,
    leaseId: () => randomBytes(24).toString('base64url'),
  })

  const admission = createGoogleExecutionAdmissionService({
    nowMs: deps.nowMs,
    authority: createPostgresGoogleAdmissionPermitAuthority({
      pool: deps.pool,
    }),
    quotaForPolicy: coordination.quotaForPolicy,
    inFlightForPolicy: coordination.inFlightForPolicy,
  })

  const bindCredential = createGoogleCredentialBinder(
    createVersionedHmacKeyring(deps.credentialBindingKeys),
  )

  return Object.freeze({
    bindCredential,
    gateway: createGoogleEgressGateway({
      nowMs: deps.nowMs,
      bindCredential,
      routeTarget: deps.routeTarget,
      admission,
      fetch,
      logger: deps.logger,
    }),
  })
}
