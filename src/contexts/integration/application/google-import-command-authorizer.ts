import {
  exactVectorDrift,
  frozenVectorDrift,
  googleAuthorizationPermissionDigest,
  sameFrozenGoogleContentAuthorizationVector,
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
import { canManageOrganizationGoogleConnections } from './google-organization-authority'

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
    connection.scopes.includes(GOOGLE_BUSINESS_MANAGE_SCOPE)
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

type ConnectionCounters = Readonly<{
  lifecycleVersion: number
  accessVersion: number
  credentialGeneration: number
}>

/** The three connection counters as they are logged, from the live row. */
function observedCounters(connection: GoogleConnection): ConnectionCounters {
  return {
    lifecycleVersion: connection.lifecycleVersion,
    accessVersion: connection.accessVersion,
    credentialGeneration: connection.credentialGeneration,
  }
}

/** The same three counters as frozen at approval time. */
function frozenCounters(
  expected: NonNullable<Parameters<GoogleImportCommandAuthorizer>[0]['expected']>,
): ConnectionCounters {
  return {
    lifecycleVersion: expected.connectionLifecycleVersion,
    accessVersion: expected.connectionAccessVersion,
    credentialGeneration: expected.credentialGeneration,
  }
}

/** Why a relink target no longer matches the snapshot frozen for it. */
function propertyDrift(
  expectedProperty: GoogleImportAuthorizationPropertySnapshot,
  property: PropertyAuthorizationView | null,
): Readonly<Record<string, unknown>> {
  return {
    propertyId: expectedProperty.propertyId,
    expected: {
      sourceEpoch: expectedProperty.sourceEpoch,
      profileVersion: expectedProperty.profileVersion,
    },
    observed: {
      missing: !property,
      idMismatch: property ? property.propertyId !== expectedProperty.propertyId : null,
      deleted: property ? property.deletedAt !== null : null,
      lifecycleState: property?.lifecycleState ?? null,
      sourceEpoch: property?.sourceEpoch ?? null,
      profileVersion: property?.profileVersion ?? null,
    },
  }
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

type AuthorizerInput = Parameters<GoogleImportCommandAuthorizer>[0]
type GrantedContentAuthorization = Extract<
  GoogleImportContentAuthorizationResult,
  { ok: true }
>
type Denied = Extract<GoogleImportCommandAuthorizationResult, { ok: false }>

/** A pipeline step either denies outright or carries its value to the next step. */
type Stage<TValue> = Denied | Readonly<{ ok: true; value: TValue }>

const staged = <TValue>(value: TValue): Stage<TValue> => ({ ok: true, value })

type DecideCapability = (
  capability: 'property.import_gbp_v2' | 'property.connect_gbp',
  action?: string,
  propertyId?: PropertyId,
) => Promise<GoogleImportExecutionDecision>

/** The connection facts re-read after token access, compared to the pre-access read. */
type TokenAccess = Readonly<{
  accessToken: string | null
  connection: GoogleConnection
  contentAuthorization: GrantedContentAuthorization
}>

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
    clock: () => Date
    /**
     * Structured warn for a refused authorization. Optional: unset is a no-op,
     * so tests and any caller that has no logger stay unchanged.
     */
    warn?: (fields: Readonly<Record<string, unknown>>, message: string) => void
  }>,
): GoogleImportCommandAuthorizer {
  const warn = deps.warn ?? (() => {})

  const deny = (code: Denied['code']): Denied => ({ ok: false, code })

  /**
   * `authorization_changed` is returned by six distinct checks, and the
   * persisted outcome code cannot say which one fired — the note in the
   * property loop below records an investigation that lost its bearings to
   * exactly that ambiguity. Every site therefore names itself and logs the
   * values that differed. Content-free by construction: identifiers, integer
   * version counters, booleans, and `permissionDigest`, which is already a
   * sha256.
   */
  const denyChanged = (fields: Readonly<Record<string, unknown>>): Denied => {
    warn(fields, 'google_import.authorization_changed_detail')
    return deny('authorization_changed')
  }

  /** Both organization-level capabilities, and the execution policy version they agreed on. */
  const authorizeOrganizationCapabilities = async (
    decideCapability: DecideCapability,
  ): Promise<Stage<string>> => {
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
    return staged(importDecision.policyVersion)
  }

  /** Usability plus the frozen-expectation re-check, applied identically before and after token access. */
  const verifyConnection = (
    input: AuthorizerInput,
    connection: GoogleConnection | null,
    site: string,
  ): Stage<GoogleConnection> => {
    if (!connection || !connectionIsUsable(connection, input)) {
      return deny('connection_unavailable')
    }
    if (input.expected && !sameExpectedConnection(connection, input.expected)) {
      return denyChanged({
        site,
        organizationId: input.actor.organizationId,
        connectionId: input.connectionId,
        expected: frozenCounters(input.expected),
        observed: observedCounters(connection),
      })
    }
    return staged(connection)
  }

  const loadConnection = async (
    input: AuthorizerInput,
  ): Promise<Stage<GoogleConnection>> => {
    let connection: GoogleConnection | null
    try {
      connection = await deps.connectionRepo.findById(
        input.actor.organizationId,
        input.connectionId,
      )
    } catch {
      return deny('runtime_unavailable')
    }
    return verifyConnection(input, connection, 'expected_connection_pre_token')
  }

  const verifyPropertySnapshots = async (
    input: AuthorizerInput,
    decideCapability: DecideCapability,
  ): Promise<Stage<null>> => {
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
            ...propertyDrift(expectedProperty, property),
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
    return staged(null)
  }

  const authorizeContent = async (
    input: AuthorizerInput,
  ): Promise<Stage<GrantedContentAuthorization>> => {
    try {
      const result = await deps.authorizeGoogleContent({
        actor: input.actor,
        connectionId: input.connectionId,
        phase: input.phase,
        properties: input.properties ?? [],
      })
      if (!result.ok) return deny(result.code)
      return staged(result)
    } catch {
      return deny('runtime_unavailable')
    }
  }

  const acquireAccessToken = async (
    input: AuthorizerInput,
    connectionBeforeTokenAccess: GoogleConnection,
    contentAuthorization: GrantedContentAuthorization,
  ): Promise<Stage<TokenAccess>> => {
    let accessToken: string | null
    let reread: GoogleConnection | null
    try {
      accessToken = await deps.tokenProvider.getAccessToken(
        input.actor.organizationId,
        input.connectionId,
        (input.properties ?? []).map((property) => property.propertyId),
      )
      reread = await deps.connectionRepo.findById(
        input.actor.organizationId,
        input.connectionId,
      )
    } catch {
      return deny('runtime_unavailable')
    }
    const verified = verifyConnection(input, reread, 'expected_connection_post_token')
    if (!verified.ok) return verified
    const connection = verified.value
    if (
      connection.lifecycleVersion !== connectionBeforeTokenAccess.lifecycleVersion ||
      connection.accessVersion !== connectionBeforeTokenAccess.accessVersion ||
      connection.credentialGeneration < connectionBeforeTokenAccess.credentialGeneration
    ) {
      return denyChanged({
        site: 'connection_moved_during_token_access',
        organizationId: input.actor.organizationId,
        connectionId: input.connectionId,
        before: observedCounters(connectionBeforeTokenAccess),
        after: observedCounters(connection),
      })
    }
    if (
      connection.credentialGeneration > connectionBeforeTokenAccess.credentialGeneration
    ) {
      const refreshed = await authorizeContent(input)
      if (!refreshed.ok) return refreshed
      return staged({ accessToken, connection, contentAuthorization: refreshed.value })
    }
    return staged({ accessToken, connection, contentAuthorization })
  }

  /** Both sides built inside this request, so every compared dimension must agree now. */
  const sameRequestVectorDrift = (
    input: AuthorizerInput,
    executionPolicyVersion: string,
    contentAuthorization: GrantedContentAuthorization,
    connection: GoogleConnection,
  ): Denied | null => {
    const permissionVersion = contentAuthorization.authorizationVector.permissionVersion
    if (
      contentAuthorization.authorizationVector.principalKind !== 'user' ||
      !Number.isSafeInteger(permissionVersion) ||
      Number(permissionVersion) < 0
    ) {
      return denyChanged({ site: 'principal_generation_vector' })
    }
    const expectedAuthorizationVector = {
      executionPolicyVersion,
      principalKind: 'user',
      role: input.actor.role,
      permissionVersion: Number(permissionVersion),
      permissionDigest: googleAuthorizationPermissionDigest(input.actor),
      connectionLifecycleVersion: connection.lifecycleVersion,
      connectionAccessVersion: connection.accessVersion,
      credentialGeneration: connection.credentialGeneration,
    } as const
    if (
      sameFrozenGoogleContentAuthorizationVector(
        contentAuthorization.authorizationVector,
        expectedAuthorizationVector,
      )
    ) {
      return null
    }
    // Same request, but NOT the same read: the content authority builds its
    // vector from its own SQL read of the connection row and its own policy
    // snapshot (google-content-authorization-check.ts), while the expectation
    // above is recomputed from `deps.connectionRepo.findById` and
    // `contentAuthorization.policyVersion`. So the two non-revoking counters
    // can legitimately differ across those reads inside one request:
    //   * `googleContentPolicyVersion` - a concurrent capability write bumps
    //     the global cache generation. The sibling item of a two-item import
    //     does exactly that (provisioning writes capability rows), which is
    //     how this cancelled healthy relinks ~50% of the time in CI.
    //   * `credentialGeneration` - a routine token refresh landing between
    //     the two reads.
    // Neither withdraws authority, and every dimension that does is still
    // compared exactly. This must stay `sameFrozen...`, not exact equality.
    return denyChanged({
      site: 'same_request_vector',
      // Reports the excluded keys too: this is a mismatch in a dimension that
      // is compared, and an empty drift array once cost an investigation.
      drift: exactVectorDrift(
        contentAuthorization.authorizationVector,
        expectedAuthorizationVector,
      ),
    })
  }

  /**
   * `input.expected` was frozen when the job was approved; everything above
   * was recomputed just now. This is the only CROSS-TIME vector comparison
   * in the codebase (`sameRequestVectorDrift` builds both sides in this
   * request), so it is the only one that must tolerate a counter that moves
   * without revoking anything — a routine token refresh bumping
   * `credentialGeneration`. See `FROZEN_VECTOR_EXCLUDED_KEYS`. Every other
   * authorization fact still has to match exactly.
   *
   * This used to name a second tolerated counter, the global policy cache
   * generation, and to promise that `emergencyKillVersion` was still compared.
   * WP2.2 step 2 removed both from the vector; the kill switch is enforced by
   * `control.denied`, read live on every decision, not by comparing a counter.
   */
  const frozenVectorDriftDenial = (
    input: AuthorizerInput,
    authorization: Readonly<{
      approvalBindingId: string
      authorizationVector: Readonly<Record<string, string | number | boolean | null>>
    }>,
    connection: GoogleConnection,
  ): Denied | null => {
    if (!input.expected) return null
    const approvalBindingDrift =
      input.expected.approvalBindingId !== authorization.approvalBindingId
    if (
      !approvalBindingDrift &&
      sameFrozenGoogleContentAuthorizationVector(
        input.expected.authorizationVector,
        authorization.authorizationVector,
      )
    ) {
      return null
    }
    return denyChanged({
      site: 'frozen_vector',
      approvalBindingDrift,
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

  return async (input) => {
    if (!canManageOrganizationGoogleConnections(input.actor)) {
      return deny('authorization_denied')
    }

    const decideCapability: DecideCapability = async (
      capability,
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
        now: deps.clock(),
      })

    const executionPolicy = await authorizeOrganizationCapabilities(decideCapability)
    if (!executionPolicy.ok) return executionPolicy

    const connectionBeforeTokenAccess = await loadConnection(input)
    if (!connectionBeforeTokenAccess.ok) return connectionBeforeTokenAccess

    const properties = await verifyPropertySnapshots(input, decideCapability)
    if (!properties.ok) return properties

    const granted = await authorizeContent(input)
    if (!granted.ok) return granted

    const tokenAccess = input.requireAccessToken
      ? await acquireAccessToken(input, connectionBeforeTokenAccess.value, granted.value)
      : staged<TokenAccess>({
          accessToken: null,
          connection: connectionBeforeTokenAccess.value,
          contentAuthorization: granted.value,
        })
    if (!tokenAccess.ok) return tokenAccess
    const { accessToken, connection, contentAuthorization } = tokenAccess.value

    const sameRequestDenial = sameRequestVectorDrift(
      input,
      executionPolicy.value,
      contentAuthorization,
      connection,
    )
    if (sameRequestDenial) return sameRequestDenial

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

    const frozenDenial = frozenVectorDriftDenial(input, authorization, connection)
    if (frozenDenial) return frozenDenial

    return { ok: true, authorization, accessToken }
  }
}
