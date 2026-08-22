import {
  frozenVectorDrift,
  googleAuthorizationPermissionDigest,
  sameFrozenGoogleContentAuthorizationVector,
  sameGoogleContentAuthorizationVector,
} from '#/shared/domain/google-content-authorization-vector'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'
import type { GoogleConnection } from '../domain/types'
import type { GoogleConnectionRepository } from './ports/google-connection.repository'
import type { ActiveConnectionTokenProvider } from './active-connection-token-provider'
import type {
  GoogleImportAuthorizationPropertySnapshot,
  GoogleImportCommandAuthorizer,
  GoogleImportCommandAuthorizationResult,
} from './google-import-discovery'
import { GOOGLE_BUSINESS_MANAGE_SCOPE } from './google-provider-contract'

type PropertyAuthorizationView = Readonly<{
  propertyId: PropertyId
  sourceEpoch: number
  profileVersion: number
  lifecycleState: string
  deletedAt: Date | null
}>
type GoogleImportDecisionRequest = Readonly<{
  principal: Readonly<{ kind: 'user'; ctx: AuthContext }>
  action: string
  capability: 'property.import_gbp_v2' | 'property.connect_gbp'
  organizationId: string
  propertyId?: PropertyId
  executionKind: 'interactive'
  now: Date
}>

type GoogleImportExecutionDecision = Readonly<{
  allowed: boolean
  policyVersion: string
}>

function connectionIsUsable(
  connection: GoogleConnection,
  input: Parameters<GoogleImportCommandAuthorizer>[0],
): boolean {
  return (
    connection.organizationId === input.actor.organizationId &&
    connection.id === input.connectionId &&
    connection.status === 'active' &&
    connection.credentialUseState === 'active' &&
    connection.scopes.includes(GOOGLE_BUSINESS_MANAGE_SCOPE) &&
    (connection.visibility === 'organization' ||
      connection.connectedBy === input.actor.userId)
  )
}

/**
 * The connection facts frozen at approval time, re-checked at effect time.
 *
 * `lifecycleVersion` and `accessVersion` are REVOCATION epochs — only
 * disconnect, reconnect and status transitions move them — so they stay exact.
 * `credentialGeneration` is the secret-material generation, which a routine
 * expired-token refresh bumps on its own (`updateTokens`,
 * `credential_generation + 1`); requiring equality reported revocation for a
 * successful refresh and cancelled any import whose token aged between
 * approval and effect. Forward motion is therefore allowed and a REGRESSION
 * still denies. See `sameFrozenGoogleContentAuthorizationVector` for the same
 * exclusion on the vector, and `get-property-google-performance.ts` for the
 * lease fence that already made this call.
 */
function sameExpectedConnection(
  connection: GoogleConnection,
  expected: NonNullable<Parameters<GoogleImportCommandAuthorizer>[0]['expected']>,
): boolean {
  return (
    connection.organizationId === expected.organizationId &&
    connection.id === expected.connectionId &&
    connection.lifecycleVersion === expected.connectionLifecycleVersion &&
    connection.accessVersion === expected.connectionAccessVersion &&
    connection.credentialGeneration >= expected.credentialGeneration
  )
}
export type GoogleImportContentAuthorizationResult =
  | Readonly<{
      ok: true
      approvalBindingId: string
      policyVersion: number
      emergencyKillVersion: number
      authorizationVector: Readonly<Record<string, string | number | boolean | null>>
    }>
  | Readonly<{
      ok: false
      code: 'authorization_denied' | 'runtime_unavailable'
    }>

export type GoogleImportContentAuthorizer = (
  input: Readonly<{
    actor: Parameters<GoogleImportCommandAuthorizer>[0]['actor']
    connectionId: Parameters<GoogleImportCommandAuthorizer>[0]['connectionId']
    phase: Parameters<GoogleImportCommandAuthorizer>[0]['phase']
    properties: readonly GoogleImportAuthorizationPropertySnapshot[]
  }>,
) => Promise<GoogleImportContentAuthorizationResult>

export function createGoogleImportCommandAuthorizer(
  deps: Readonly<{
    connectionRepo: Pick<GoogleConnectionRepository, 'findById'>
    tokenProvider: Pick<ActiveConnectionTokenProvider, 'getAccessToken'>
    decide: (
      request: GoogleImportDecisionRequest,
    ) => Promise<GoogleImportExecutionDecision>
    authorizeGoogleContent: GoogleImportContentAuthorizer
    readProperty: (
      organizationId: Parameters<GoogleConnectionRepository['findById']>[0],
      propertyId: PropertyId,
    ) => Promise<PropertyAuthorizationView | null>
    clock?: () => Date
    /**
     * Structured warn for a refused authorization. Optional: unset is a no-op,
     * so tests and any caller that has no logger stay unchanged.
     */
    warn?: (fields: Readonly<Record<string, unknown>>, message: string) => void
  }>,
): GoogleImportCommandAuthorizer {
  const clock = deps.clock ?? (() => new Date())
  const warn = deps.warn ?? (() => {})

  const deny = (
    code: Extract<GoogleImportCommandAuthorizationResult, { ok: false }>['code'],
  ): GoogleImportCommandAuthorizationResult => ({ ok: false, code })

  /**
   * `authorization_changed` is returned by six distinct checks, and the
   * persisted outcome code cannot say which one fired — the note in the
   * property loop below records an investigation that lost its bearings to
   * exactly that ambiguity. Every site therefore names itself and logs the
   * values that differed. Content-free by construction: identifiers, integer
   * version counters, booleans, and `permissionDigest`, which is already a
   * sha256.
   */
  const denyChanged = (
    fields: Readonly<Record<string, unknown>>,
  ): GoogleImportCommandAuthorizationResult => {
    warn(fields, 'google_import.authorization_changed_detail')
    return deny('authorization_changed')
  }

  return async (input) => {
    const decideCapability = async (
      capability: 'property.import_gbp_v2' | 'property.connect_gbp',
      action = 'integration.manage',
      propertyId?: PropertyId,
    ) =>
      deps.decide({
        principal: { kind: 'user', ctx: input.actor },
        action,
        capability,
        organizationId: input.actor.organizationId,
        ...(propertyId ? { propertyId } : {}),
        executionKind: 'interactive',
        now: clock(),
      })

    let importDecision: GoogleImportExecutionDecision
    let connectDecision: GoogleImportExecutionDecision
    try {
      importDecision = await decideCapability('property.import_gbp_v2')
      if (!importDecision.allowed) return deny('authorization_denied')
      connectDecision = await decideCapability('property.connect_gbp')
      if (!connectDecision.allowed) return deny('authorization_denied')
    } catch {
      return deny('runtime_unavailable')
    }
    if (importDecision.policyVersion !== connectDecision.policyVersion) {
      return deny('runtime_unavailable')
    }

    let connection: GoogleConnection | null
    try {
      connection = await deps.connectionRepo.findById(
        input.actor.organizationId,
        input.connectionId,
      )
    } catch {
      return deny('runtime_unavailable')
    }
    if (!connection || !connectionIsUsable(connection, input)) {
      return deny('connection_unavailable')
    }
    if (input.expected && !sameExpectedConnection(connection, input.expected)) {
      return denyChanged({
        site: 'expected_connection_pre_token',
        organizationId: input.actor.organizationId,
        connectionId: input.connectionId,
        expected: {
          lifecycleVersion: input.expected.connectionLifecycleVersion,
          accessVersion: input.expected.connectionAccessVersion,
          credentialGeneration: input.expected.credentialGeneration,
        },
        observed: {
          lifecycleVersion: connection.lifecycleVersion,
          accessVersion: connection.accessVersion,
          credentialGeneration: connection.credentialGeneration,
        },
      })
    }

    try {
      for (const expectedProperty of input.properties ?? []) {
        const property = await deps.readProperty(
          input.actor.organizationId,
          expectedProperty.propertyId,
        )
        if (
          !property ||
          property.propertyId !== expectedProperty.propertyId ||
          property.deletedAt !== null ||
          property.lifecycleState !== 'active' ||
          property.sourceEpoch !== expectedProperty.sourceEpoch ||
          property.profileVersion !== expectedProperty.profileVersion
        ) {
          return denyChanged({
            site: 'property_snapshot',
            propertyId: expectedProperty.propertyId,
            expected: {
              sourceEpoch: expectedProperty.sourceEpoch,
              profileVersion: expectedProperty.profileVersion,
            },
            observed: {
              missing: !property,
              idMismatch: property
                ? property.propertyId !== expectedProperty.propertyId
                : null,
              deleted: property ? property.deletedAt !== null : null,
              lifecycleState: property?.lifecycleState ?? null,
              sourceEpoch: property?.sourceEpoch ?? null,
              profileVersion: property?.profileVersion ?? null,
            },
          })
        }
        const propertyDecision = await decideCapability(
          'property.import_gbp_v2',
          expectedProperty.action,
          expectedProperty.propertyId,
        )
        // A per-property capability denial is the GATE saying no — not the
        // frozen expectations above drifting — so it reports
        // `authorization_denied`, the same code the org-level gate uses. It
        // previously reported `authorization_changed`, which made a cancelled
        // item indistinguishable from real expectation drift and is the line
        // that cost an earlier investigation its bearings.
        if (!propertyDecision.allowed) return deny('authorization_denied')
        // Removed: `propertyDecision.policyVersion !== importDecision.policyVersion`.
        // Unreachable, not merely unlikely — `ExecutionDecision.policyVersion`
        // is only ever set by `finish()` in execution-policy.ts, always to the
        // build constant `EXECUTION_POLICY_VERSION`, so two decisions from one
        // process cannot differ. The invariant it appeared to enforce — that
        // both decisions saw the same policy generation — is now actually
        // enforced, by the mandatory policy refresh in front of every
        // `decide` call failing loudly instead of deciding from a stale
        // snapshot.
      }
    } catch {
      return deny('runtime_unavailable')
    }
    const connectionBeforeTokenAccess = connection
    let contentAuthorization: Extract<
      GoogleImportContentAuthorizationResult,
      { ok: true }
    >
    try {
      const result = await deps.authorizeGoogleContent({
        actor: input.actor,
        connectionId: input.connectionId,
        phase: input.phase,
        properties: input.properties ?? [],
      })
      if (!result.ok) return deny(result.code)
      contentAuthorization = result
    } catch {
      return deny('runtime_unavailable')
    }

    let accessToken: string | null = null
    if (input.requireAccessToken) {
      try {
        accessToken = await deps.tokenProvider.getAccessToken(
          input.actor.organizationId,
          input.connectionId,
        )
        connection = await deps.connectionRepo.findById(
          input.actor.organizationId,
          input.connectionId,
        )
      } catch {
        return deny('runtime_unavailable')
      }
      if (!connection || !connectionIsUsable(connection, input)) {
        return deny('connection_unavailable')
      }
      if (input.expected && !sameExpectedConnection(connection, input.expected)) {
        return denyChanged({
          site: 'expected_connection_post_token',
          organizationId: input.actor.organizationId,
          connectionId: input.connectionId,
          expected: {
            lifecycleVersion: input.expected.connectionLifecycleVersion,
            accessVersion: input.expected.connectionAccessVersion,
            credentialGeneration: input.expected.credentialGeneration,
          },
          observed: {
            lifecycleVersion: connection.lifecycleVersion,
            accessVersion: connection.accessVersion,
            credentialGeneration: connection.credentialGeneration,
          },
        })
      }
      if (
        connection.lifecycleVersion !== connectionBeforeTokenAccess.lifecycleVersion ||
        connection.accessVersion !== connectionBeforeTokenAccess.accessVersion ||
        connection.credentialGeneration < connectionBeforeTokenAccess.credentialGeneration
      ) {
        return denyChanged({
          site: 'connection_moved_during_token_access',
          organizationId: input.actor.organizationId,
          connectionId: input.connectionId,
          before: {
            lifecycleVersion: connectionBeforeTokenAccess.lifecycleVersion,
            accessVersion: connectionBeforeTokenAccess.accessVersion,
            credentialGeneration: connectionBeforeTokenAccess.credentialGeneration,
          },
          after: {
            lifecycleVersion: connection.lifecycleVersion,
            accessVersion: connection.accessVersion,
            credentialGeneration: connection.credentialGeneration,
          },
        })
      }
      if (
        connection.credentialGeneration > connectionBeforeTokenAccess.credentialGeneration
      ) {
        try {
          const refreshed = await deps.authorizeGoogleContent({
            actor: input.actor,
            connectionId: input.connectionId,
            phase: input.phase,
            properties: input.properties ?? [],
          })
          if (!refreshed.ok) return deny(refreshed.code)
          contentAuthorization = refreshed
        } catch {
          return deny('runtime_unavailable')
        }
      }
    }

    const expectedAuthorizationVector = {
      executionPolicyVersion: importDecision.policyVersion,
      googleContentPolicyVersion: contentAuthorization.policyVersion,
      emergencyKillVersion: contentAuthorization.emergencyKillVersion,
      role: input.actor.role,
      permissionDigest: googleAuthorizationPermissionDigest(input.actor),
      connectionLifecycleVersion: connection.lifecycleVersion,
      connectionAccessVersion: connection.accessVersion,
      credentialGeneration: connection.credentialGeneration,
    } as const
    if (
      !sameGoogleContentAuthorizationVector(
        contentAuthorization.authorizationVector,
        expectedAuthorizationVector,
      )
    ) {
      // Both sides were built in THIS request, so exact equality is right here
      // — a mismatch means the content authorizer disagreed with the facts it
      // was just handed, not that time passed.
      return denyChanged({
        site: 'same_request_vector',
        drift: frozenVectorDrift(
          contentAuthorization.authorizationVector,
          expectedAuthorizationVector,
        ),
      })
    }
    const authorization = {
      organizationId: input.actor.organizationId,
      userId: input.actor.userId,
      connectionId: input.connectionId,
      connectionLifecycleVersion: connection.lifecycleVersion,
      connectionAccessVersion: connection.accessVersion,
      credentialGeneration: connection.credentialGeneration,
      approvalBindingId: contentAuthorization.approvalBindingId,
      authorizationVector: contentAuthorization.authorizationVector,
    } as const
    if (input.expected) {
      // `input.expected` was frozen when the job was approved; everything above
      // was recomputed just now. This is the only CROSS-TIME vector comparison
      // in the codebase (the one above builds both sides in this request), so
      // it is the only one that must tolerate the two counters that move
      // without revoking anything — the global policy cache generation and a
      // routine token refresh. See `FROZEN_VECTOR_EXCLUDED_KEYS`. Every other
      // authorization fact still has to match exactly, `emergencyKillVersion`
      // included.
      if (
        input.expected.approvalBindingId !== authorization.approvalBindingId ||
        !sameFrozenGoogleContentAuthorizationVector(
          input.expected.authorizationVector,
          authorization.authorizationVector,
        )
      ) {
        return denyChanged({
          site: 'frozen_vector',
          approvalBindingDrift:
            input.expected.approvalBindingId !== authorization.approvalBindingId,
          credentialGeneration: {
            frozen: input.expected.credentialGeneration,
            observed: connection.credentialGeneration,
          },
          drift: frozenVectorDrift(
            input.expected.authorizationVector,
            authorization.authorizationVector,
          ),
        })
      }
    }
    return { ok: true, authorization, accessToken }
  }
}
