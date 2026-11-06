import {
  googleConnectionAuthorizationVector,
  googleUserAuthorizationVector,
} from './google-authorization-vector'
import {
  exactVectorDrift,
  frozenVectorDrift,
  sameFrozenGoogleContentAuthorizationVector,
} from '#/shared/domain/google-content-authorization-vector'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { GoogleConnection } from '../domain/types'
import type { GoogleConnectionRepository } from './ports/google-connection.repository'
import type { ActiveConnectionTokenProvider } from './active-connection-token-provider'
import { errorFactTags } from '#/shared/observability/error-facts'
import type {
  GoogleImportAuthorizationPropertySnapshot,
  GoogleImportAuthorizerUnavailableStep,
  GoogleImportCommandAuthorizer,
  GoogleImportCommandAuthorizationResult,
} from './google-import-discovery'
import { GOOGLE_BUSINESS_MANAGE_SCOPE } from './google-provider-contract'
import { canManageOrganizationGoogleConnections } from './google-organization-authority'

// An error's class name as a log field: anything else (a name built from data)
// is logged as `unknown`.
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_$]{0,63}$/u

type PropertyAuthorizationView = Readonly<{
  organizationId: OrganizationId
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

/** Revocation epochs stay exact; routine credential refresh may only advance. */
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

  // `runtime_unavailable` goes through `denyUnavailable`, which names the step.
  const deny = (code: Exclude<Denied['code'], 'runtime_unavailable'>): Denied => ({
    ok: false,
    code,
  })

  /** Version counters and digest drift explain refusals without logging tenant data. */
  const denyChanged = (fields: Readonly<Record<string, unknown>>): Denied => {
    warn(fields, 'google_import.authorization_changed_detail')
    return deny('authorization_changed')
  }

  /** Preserve the failing dependency's stage and allowlisted codes, never its message. */
  const denyUnavailable = (
    step: GoogleImportAuthorizerUnavailableStep,
    error?: unknown,
  ): Denied => {
    warn(
      {
        step,
        ...(error === undefined
          ? {}
          : {
              errorName:
                error instanceof Error && ERROR_NAME.test(error.name)
                  ? error.name
                  : 'unknown',
              ...errorFactTags(error),
            }),
      },
      'google_import.runtime_unavailable_detail',
    )
    return { ok: false, code: 'runtime_unavailable', step }
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
    } catch (error) {
      return denyUnavailable('capability_decision', error)
    }
    if (importDecision.policyVersion !== connectDecision.policyVersion) {
      return denyUnavailable('policy_version_mismatch')
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
    } catch (error) {
      return denyUnavailable('connection_read', error)
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
          property.organizationId !== input.actor.organizationId ||
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
        // A live policy refusal is distinct from a changed relink snapshot.
        if (!propertyDecision.allowed) return deny('authorization_denied')
      }
    } catch (error) {
      return denyUnavailable('property_snapshot', error)
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
      if (!result.ok) {
        return result.code === 'runtime_unavailable'
          ? denyUnavailable('content_authorization')
          : deny(result.code)
      }
      return staged(result)
    } catch (error) {
      return denyUnavailable('content_authorization', error)
    }
  }

  const acquireAccessToken = async (
    input: AuthorizerInput,
    connectionBeforeTokenAccess: GoogleConnection,
    decideCapability: DecideCapability,
  ): Promise<Stage<TokenAccess>> => {
    let accessToken: string | null
    let reread: GoogleConnection | null
    try {
      accessToken = await deps.tokenProvider.getAccessToken(
        input.actor.organizationId,
        input.connectionId,
      )
    } catch (error) {
      return denyUnavailable('token_access', error)
    }
    try {
      reread = await deps.connectionRepo.findById(
        input.actor.organizationId,
        input.connectionId,
      )
    } catch (error) {
      return denyUnavailable('token_reread', error)
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
        before: observedCounters(connectionBeforeTokenAccess),
        after: observedCounters(connection),
      })
    }
    const executionPolicy = await authorizeOrganizationCapabilities(decideCapability)
    if (!executionPolicy.ok) return executionPolicy
    const properties = await verifyPropertySnapshots(input, decideCapability)
    if (!properties.ok) return properties
    const refreshed = await authorizeContent(input)
    if (!refreshed.ok) return refreshed
    return staged({ accessToken, connection, contentAuthorization: refreshed.value })
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
      ...googleUserAuthorizationVector(
        input.actor,
        Number(permissionVersion),
        executionPolicyVersion,
      ),
      ...googleConnectionAuthorizationVector(connection),
    } as const
    if (
      sameFrozenGoogleContentAuthorizationVector(
        contentAuthorization.authorizationVector,
        expectedAuthorizationVector,
      )
    ) {
      return null
    }
    // These reads may straddle a routine refresh. Revocation facts stay exact;
    // the token-access check separately rejects a credential regression.
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

  /** Delayed effects retain their approved authority across routine token refresh. */
  const frozenVectorDriftDenial = (
    input: AuthorizerInput,
    authorization: Readonly<{
      authorizationVector: Readonly<Record<string, string | number | boolean | null>>
    }>,
    connection: GoogleConnection,
  ): Denied | null => {
    if (!input.expected) return null
    if (
      sameFrozenGoogleContentAuthorizationVector(
        input.expected.authorizationVector,
        authorization.authorizationVector,
      )
    ) {
      return null
    }
    return denyChanged({
      site: 'frozen_vector',
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
    const initialVectorDenial = sameRequestVectorDrift(
      input,
      executionPolicy.value,
      granted.value,
      connectionBeforeTokenAccess.value,
    )
    if (initialVectorDenial) return initialVectorDenial

    const tokenAccess = input.requireAccessToken
      ? await acquireAccessToken(
          input,
          connectionBeforeTokenAccess.value,
          decideCapability,
        )
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
      authorizationVector: contentAuthorization.authorizationVector,
    } as const

    const frozenDenial = frozenVectorDriftDenial(input, authorization, connection)
    if (frozenDenial) return frozenDenial

    return { ok: true, authorization, accessToken }
  }
}
