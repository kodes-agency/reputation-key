import {
  googleConnectionHasUsableCredential,
  type GooglePropertyAuthorizationView,
} from './google-property-authorization'
import { sameGooglePerformanceScope } from './google-performance-authorization-snapshot'
import {
  googleConnectionAuthorizationVector,
  googleUserAuthorizationVector,
  googlePropertyAuthorizationVector,
} from './google-authorization-vector'
import { summarizeError } from '#/shared/observability/error-summary'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { sameFrozenGoogleContentAuthorizationVector } from '#/shared/domain/google-content-authorization-vector'
import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  createProviderAuthorizationPrincipalBinding,
  providerAuthorizationFenceSha256,
  providerAuthorizationVectorSha256,
} from '#/shared/provider-ephemeral/authorization-binding'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { GoogleConnection } from '../domain/types'
import type { ActiveConnectionTokenProvider } from './active-connection-token-provider'
import type {
  GooglePerformanceAuthorizationResult,
  GooglePerformanceAuthorizationSnapshot,
  GooglePerformanceAuthorizer,
} from './get-property-google-performance'
import type { GoogleImportContentAuthorizationResult } from './google-import-command-authorizer'

type PropertyAuthorizationView = GooglePropertyAuthorizationView &
  Readonly<{
    timezone: string | null
  }>

type PerformanceDecision = Readonly<{
  allowed: boolean
  reason: string
  policyVersion: string
}>

type PerformanceDecisionRequest = Readonly<{
  principal: Readonly<{ kind: 'user'; ctx: AuthContext }>
  action: string
  capability: 'property.read_gbp_performance'
  organizationId: OrganizationId
  propertyId: PropertyId
  executionKind: 'interactive'
  now: Date
}>

export type PerformanceContentAuthorizer = (
  input: Readonly<{
    actor: AuthContext
    propertyId: PropertyId
    connectionId: GoogleConnectionId
    phase: 'before_provider' | 'before_return'
  }>,
) => Promise<GoogleImportContentAuthorizationResult>

const PRINCIPAL_AUDIENCE = 'google-performance-authorization-lease-principal-v1'

function unavailable(
  reason:
    | 'policy_disabled'
    | 'timezone_required'
    | 'disconnected'
    | 'reauthentication_required'
    | 'integration_unavailable',
  action: 'set_timezone' | 'reauthenticate' | 'open_integrations' | null,
): Extract<GooglePerformanceAuthorizationResult, { ok: false }> {
  return { ok: false, result: { status: 'unavailable', reason, action } }
}

function staleSource(): Extract<GooglePerformanceAuthorizationResult, { ok: false }> {
  return {
    ok: false,
    result: {
      status: 'error',
      errorCode: 'stale_source',
      retryable: true,
      retryAfterSeconds: null,
    },
  }
}

function connectionBelongsToOrganization(
  connection: GoogleConnection,
  actor: AuthContext,
): boolean {
  return connection.organizationId === actor.organizationId
}

function sameSnapshot(
  current: GooglePerformanceAuthorizationSnapshot,
  expected: GooglePerformanceAuthorizationSnapshot,
  allowCredentialRefresh = false,
): boolean {
  return (
    sameGooglePerformanceScope(current, expected) &&
    (allowCredentialRefresh
      ? current.credentialGeneration >= expected.credentialGeneration &&
        current.authorizationFenceSha256 === expected.authorizationFenceSha256
      : current.credentialGeneration === expected.credentialGeneration &&
        current.authorizationVectorSha256 === expected.authorizationVectorSha256)
  )
}

export function createGooglePerformanceAuthorizer(
  deps: Readonly<{
    resolveActor(
      organizationId: OrganizationId,
      userId: AuthContext['userId'],
    ): Promise<AuthContext | null>
    readBinding(
      organizationId: OrganizationId,
      propertyId: PropertyId,
    ): Promise<PropertyAuthorizationView | null>
    findConnection(
      organizationId: OrganizationId,
      connectionId: GoogleConnectionId,
    ): Promise<GoogleConnection | null>
    getAccessToken: ActiveConnectionTokenProvider['getAccessToken']
    decide(request: PerformanceDecisionRequest): Promise<PerformanceDecision>
    authorizeGoogleContent: PerformanceContentAuthorizer
    principalKeys: VersionedHmacKeyring
    clock: () => Date
    logger?: Pick<LoggerPort, 'warn'>
  }>,
): GooglePerformanceAuthorizer {
  // Keep infrastructure refusals observable while returning the controlled panel state.
  const failClosed = (
    stage: string,
    detail?: Readonly<Record<string, unknown>>,
  ): Extract<GooglePerformanceAuthorizationResult, { ok: false }> => {
    deps.logger?.warn(
      { surface: 'google-performance', stage, ...detail },
      'Google performance authorization failed closed',
    )
    return unavailable('integration_unavailable', null)
  }
  const errorFields = (error: unknown) =>
    error instanceof Error ? { err: summarizeError(error) } : {}

  const authorizeProperty = async (input: Parameters<GooglePerformanceAuthorizer>[0]) => {
    let actor: AuthContext | null
    try {
      actor = await deps.resolveActor(input.actor.organizationId, input.actor.userId)
    } catch (error) {
      return failClosed('resolve_actor', errorFields(error))
    }
    if (
      !actor ||
      actor.organizationId !== input.actor.organizationId ||
      actor.userId !== input.actor.userId
    ) {
      return unavailable('integration_unavailable', null)
    }
    const decide = async (action: string) =>
      deps.decide({
        principal: { kind: 'user', ctx: actor! },
        action,
        capability: 'property.read_gbp_performance',
        organizationId: actor!.organizationId,
        propertyId: input.propertyId,
        executionKind: 'interactive',
        now: deps.clock(),
      })

    let readDecision: PerformanceDecision
    try {
      readDecision = await decide('property.read_gbp_performance')
    } catch (error) {
      return failClosed('read_decision', errorFields(error))
    }
    if (!readDecision.allowed) {
      return readDecision.reason === 'capability_disabled'
        ? unavailable('policy_disabled', null)
        : unavailable('integration_unavailable', null)
    }

    let binding: PropertyAuthorizationView | null
    try {
      binding = await deps.readBinding(actor.organizationId, input.propertyId)
    } catch (error) {
      return failClosed('read_binding', errorFields(error))
    }
    if (
      !binding ||
      binding.organizationId !== actor.organizationId ||
      binding.propertyId !== input.propertyId ||
      binding.deletedAt !== null ||
      binding.lifecycleState !== 'active'
    ) {
      return unavailable('integration_unavailable', null)
    }

    const remediationAllowed = async (action: string): Promise<boolean> => {
      try {
        const decision = await decide(action)
        return decision.allowed && decision.policyVersion === readDecision.policyVersion
      } catch {
        return false
      }
    }

    if (binding.state !== 'active' || !binding.connectionId || !binding.locationId) {
      const canManage = await remediationAllowed('integration.manage')
      return unavailable('disconnected', canManage ? 'open_integrations' : null)
    }

    if (
      !binding.timezone ||
      binding.profileSource !== 'tenant_confirmed' ||
      binding.profileConfirmedAt === null
    ) {
      const canUpdate = await remediationAllowed('property.update')
      return unavailable('timezone_required', canUpdate ? 'set_timezone' : null)
    }

    return {
      ok: true as const,
      actor,
      binding: {
        ...binding,
        connectionId: binding.connectionId,
        locationId: binding.locationId,
        timezone: binding.timezone,
      },
      readDecision,
      remediationAllowed,
    }
  }

  type PropertyScope = Extract<
    Awaited<ReturnType<typeof authorizeProperty>>,
    { ok: true }
  >

  const authorizeConnection = async ({
    actor,
    binding,
    remediationAllowed,
  }: PropertyScope) => {
    let connection: GoogleConnection | null
    try {
      connection = await deps.findConnection(actor.organizationId, binding.connectionId)
    } catch (error) {
      return failClosed('find_connection', errorFields(error))
    }
    if (
      !connection ||
      connection.id !== binding.connectionId ||
      !connectionBelongsToOrganization(connection, actor)
    ) {
      return unavailable('integration_unavailable', null)
    }
    if (connection.status === 'reauth_required') {
      const canManage = await remediationAllowed('integration.manage')
      return unavailable('reauthentication_required', canManage ? 'reauthenticate' : null)
    }
    if (!googleConnectionHasUsableCredential(connection)) {
      const canManage = await remediationAllowed('integration.manage')
      return unavailable('disconnected', canManage ? 'open_integrations' : null)
    }

    return { ok: true as const, connection }
  }

  const authorizeContent = async (
    { actor, binding, readDecision }: PropertyScope,
    connection: GoogleConnection,
    phase: Parameters<GooglePerformanceAuthorizer>[0]['phase'],
  ) => {
    let content: Extract<GoogleImportContentAuthorizationResult, { ok: true }>
    try {
      const result = await deps.authorizeGoogleContent({
        actor,
        propertyId: binding.propertyId,
        connectionId: connection.id,
        phase,
      })
      if (!result.ok) {
        // The authority's own code is the diagnosis; the caller only ever sees
        // `policy_disabled`, so it has to be recorded here or it is lost.
        deps.logger?.warn(
          {
            surface: 'google-performance',
            stage: 'authorize_content',
            code: result.code,
          },
          'Google performance authorization denied',
        )
        return unavailable('policy_disabled', null)
      }
      content = result
    } catch (error) {
      deps.logger?.warn(
        {
          surface: 'google-performance',
          stage: 'authorize_content',
          ...errorFields(error),
        },
        'Google performance authorization threw',
      )
      return unavailable('policy_disabled', null)
    }

    const permissionVersion = content.authorizationVector.permissionVersion
    if (
      content.authorizationVector.principalKind !== 'user' ||
      !Number.isSafeInteger(permissionVersion) ||
      Number(permissionVersion) < 0
    ) {
      return unavailable('policy_disabled', null)
    }
    const expectedAuthorizationVector = Object.freeze({
      ...googleUserAuthorizationVector(
        actor,
        Number(permissionVersion),
        readDecision.policyVersion,
      ),
      ...googleConnectionAuthorizationVector(connection),
      ...googlePropertyAuthorizationVector(binding),
    })
    if (
      // Separate reads may straddle a refresh; all revocation facts stay exact.
      !sameFrozenGoogleContentAuthorizationVector(
        content.authorizationVector,
        expectedAuthorizationVector,
      )
    ) {
      return unavailable('policy_disabled', null)
    }

    return content
  }

  const authorizeScope: GooglePerformanceAuthorizer = async (input) => {
    const scope = await authorizeProperty(input)
    if (!scope.ok) return scope
    const connected = await authorizeConnection(scope)
    if (!connected.ok) return connected
    const { connection } = connected
    const content = await authorizeContent(scope, connection, input.phase)
    if (!content.ok) return content
    const { actor, binding } = scope
    const authorizationVector = content.authorizationVector
    const principal = createProviderAuthorizationPrincipalBinding({
      keys: deps.principalKeys,
      audience: PRINCIPAL_AUDIENCE,
      organizationId: actor.organizationId,
      userId: actor.userId,
      connectionId: connection.id,
    })
    const snapshot: GooglePerformanceAuthorizationSnapshot = Object.freeze({
      organizationId: actor.organizationId,
      propertyId: binding.propertyId,
      connectionId: connection.id,
      locationId: binding.locationId,
      timezone: binding.timezone,
      sourceEpoch: binding.sourceEpoch,
      profileVersion: binding.profileVersion,
      connectionLifecycleVersion: connection.lifecycleVersion,
      connectionAccessVersion: connection.accessVersion,
      credentialGeneration: connection.credentialGeneration,
      authorizationVector,
      authorizationVectorSha256: providerAuthorizationVectorSha256({
        connectionLifecycleVersion: connection.lifecycleVersion,
        connectionAccessVersion: connection.accessVersion,
        credentialGeneration: connection.credentialGeneration,
        authorizationVector,
      }),
      authorizationFenceSha256: providerAuthorizationFenceSha256({
        connectionLifecycleVersion: connection.lifecycleVersion,
        connectionAccessVersion: connection.accessVersion,
        authorizationVector,
      }),
      principalHmacKeyVersion: principal.principalHmacKeyVersion,
      principalHmac: principal.principalHmac,
    })

    if (input.expected && !sameSnapshot(snapshot, input.expected)) {
      return staleSource()
    }
    return { ok: true, snapshot, accessToken: null }
  }

  return async (input) => {
    const initial = await authorizeScope(input)
    if (
      !initial.ok ||
      input.phase === 'before_return' ||
      input.requireAccessToken === false
    ) {
      return initial
    }

    let accessToken: string
    try {
      accessToken = await deps.getAccessToken(
        initial.snapshot.organizationId,
        initial.snapshot.connectionId,
      )
    } catch {
      return unavailable('integration_unavailable', null)
    }
    // Token refresh may advance the credential generation, but cannot carry a
    // changed member, Property binding or connection authority into a permit.
    const current = await authorizeScope({ ...input, expected: undefined })
    if (!current.ok) return current
    if (!sameSnapshot(current.snapshot, initial.snapshot, true)) return staleSource()
    return { ...current, accessToken }
  }
}
