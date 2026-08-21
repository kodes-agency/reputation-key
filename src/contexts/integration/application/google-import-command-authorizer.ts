import {
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

function sameExpectedConnection(
  connection: GoogleConnection,
  expected: NonNullable<Parameters<GoogleImportCommandAuthorizer>[0]['expected']>,
): boolean {
  return (
    connection.organizationId === expected.organizationId &&
    connection.id === expected.connectionId &&
    connection.lifecycleVersion === expected.connectionLifecycleVersion &&
    connection.accessVersion === expected.connectionAccessVersion &&
    connection.credentialGeneration === expected.credentialGeneration
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
  }>,
): GoogleImportCommandAuthorizer {
  const clock = deps.clock ?? (() => new Date())

  const deny = (
    code: Extract<GoogleImportCommandAuthorizationResult, { ok: false }>['code'],
  ): GoogleImportCommandAuthorizationResult => ({ ok: false, code })

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
      return deny('authorization_changed')
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
          return deny('authorization_changed')
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
        return deny('authorization_changed')
      }
      if (
        connection.lifecycleVersion !== connectionBeforeTokenAccess.lifecycleVersion ||
        connection.accessVersion !== connectionBeforeTokenAccess.accessVersion ||
        connection.credentialGeneration < connectionBeforeTokenAccess.credentialGeneration
      ) {
        return deny('authorization_changed')
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
      return deny('authorization_changed')
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
      // in the codebase (the one at :270 builds both sides in this request), so
      // it is the only one that must tolerate the global policy cache
      // generation moving underneath it — see
      // `sameFrozenGoogleContentAuthorizationVector`. Every authorization fact
      // still has to match exactly, `emergencyKillVersion` included.
      if (
        input.expected.approvalBindingId !== authorization.approvalBindingId ||
        !sameFrozenGoogleContentAuthorizationVector(
          input.expected.authorizationVector,
          authorization.authorizationVector,
        )
      ) {
        return deny('authorization_changed')
      }
    }
    return { ok: true, authorization, accessToken }
  }
}
