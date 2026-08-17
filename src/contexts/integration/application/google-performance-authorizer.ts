import type { AuthContext } from '#/shared/domain/auth-context'
import {
  googleAuthorizationPermissionDigest,
  sameGoogleContentAuthorizationVector,
} from '#/shared/domain/google-content-authorization-vector'
import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  createProviderAuthorizationPrincipalBinding,
  providerAuthorizationVectorSha256,
} from '#/shared/provider-ephemeral/authorization-binding'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { GoogleConnection } from '../domain/types'
import type { ActiveConnectionTokenProvider } from './active-connection-token-provider'
import { GOOGLE_BUSINESS_MANAGE_SCOPE } from './google-provider-contract'
import type {
  GooglePerformanceAuthorizationResult,
  GooglePerformanceAuthorizationSnapshot,
  GooglePerformanceAuthorizer,
} from './get-property-google-performance'
import type { GoogleImportContentAuthorizationResult } from './google-import-command-authorizer'

type PropertyAuthorizationView = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  state: string
  connectionId: GoogleConnectionId | null
  locationId: string | null
  sourceEpoch: number
  profileVersion: number
  profileSource: 'legacy' | 'tenant_confirmed'
  profileConfirmedAt: Date | null
  timezone: string | null
  lifecycleState: string
  deletedAt: Date | null
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
): GooglePerformanceAuthorizationResult {
  return { ok: false, result: { status: 'unavailable', reason, action } }
}

function staleSource(): GooglePerformanceAuthorizationResult {
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

function connectionVisibleTo(connection: GoogleConnection, actor: AuthContext): boolean {
  return (
    connection.organizationId === actor.organizationId &&
    (connection.visibility === 'organization' || connection.connectedBy === actor.userId)
  )
}

function sameSnapshot(
  current: GooglePerformanceAuthorizationSnapshot,
  expected: GooglePerformanceAuthorizationSnapshot,
): boolean {
  return (
    current.organizationId === expected.organizationId &&
    current.propertyId === expected.propertyId &&
    current.connectionId === expected.connectionId &&
    current.locationId === expected.locationId &&
    current.timezone === expected.timezone &&
    current.sourceEpoch === expected.sourceEpoch &&
    current.profileVersion === expected.profileVersion &&
    current.connectionLifecycleVersion === expected.connectionLifecycleVersion &&
    current.connectionAccessVersion === expected.connectionAccessVersion &&
    current.credentialGeneration === expected.credentialGeneration &&
    current.approvalBindingId === expected.approvalBindingId &&
    current.authorizationVectorSha256 === expected.authorizationVectorSha256 &&
    current.principalHmacKeyVersion === expected.principalHmacKeyVersion &&
    current.principalHmac === expected.principalHmac
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
    clock?: () => Date
  }>,
): GooglePerformanceAuthorizer {
  const clock = deps.clock ?? (() => new Date())

  return async (input) => {
    let actor: AuthContext | null
    try {
      actor = await deps.resolveActor(input.actor.organizationId, input.actor.userId)
    } catch {
      return unavailable('integration_unavailable', null)
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
        now: clock(),
      })

    let readDecision: PerformanceDecision
    try {
      readDecision = await decide('property.read')
    } catch {
      return unavailable('integration_unavailable', null)
    }
    if (!readDecision.allowed) {
      return readDecision.reason === 'capability_disabled'
        ? unavailable('policy_disabled', null)
        : unavailable('integration_unavailable', null)
    }

    let binding: PropertyAuthorizationView | null
    try {
      binding = await deps.readBinding(actor.organizationId, input.propertyId)
    } catch {
      return unavailable('integration_unavailable', null)
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

    let connection: GoogleConnection | null
    try {
      connection = await deps.findConnection(actor.organizationId, binding.connectionId)
    } catch {
      return unavailable('integration_unavailable', null)
    }
    if (
      !connection ||
      connection.id !== binding.connectionId ||
      !connectionVisibleTo(connection, actor)
    ) {
      return unavailable('integration_unavailable', null)
    }
    if (connection.status === 'reauth_required') {
      const canManage = await remediationAllowed('integration.manage')
      return unavailable('reauthentication_required', canManage ? 'reauthenticate' : null)
    }
    if (
      connection.status !== 'active' ||
      connection.credentialUseState !== 'active' ||
      !connection.scopes.includes(GOOGLE_BUSINESS_MANAGE_SCOPE)
    ) {
      const canManage = await remediationAllowed('integration.manage')
      return unavailable('disconnected', canManage ? 'open_integrations' : null)
    }

    let content: Extract<GoogleImportContentAuthorizationResult, { ok: true }>
    try {
      const result = await deps.authorizeGoogleContent({
        actor,
        propertyId: input.propertyId,
        connectionId: connection.id,
        phase: input.phase,
      })
      if (!result.ok) return unavailable('policy_disabled', null)
      content = result
    } catch {
      return unavailable('policy_disabled', null)
    }

    const expectedAuthorizationVector = Object.freeze({
      executionPolicyVersion: readDecision.policyVersion,
      googleContentPolicyVersion: content.policyVersion,
      emergencyKillVersion: content.emergencyKillVersion,
      role: actor.role,
      permissionDigest: googleAuthorizationPermissionDigest(actor),
      connectionLifecycleVersion: connection.lifecycleVersion,
      connectionAccessVersion: connection.accessVersion,
      credentialGeneration: connection.credentialGeneration,
      propertySourceEpoch: binding.sourceEpoch,
      propertyProfileVersion: binding.profileVersion,
      propertyBindingState: binding.state,
      propertyLifecycleState: binding.lifecycleState,
      propertyProfileSource: binding.profileSource,
      propertyTimezoneConfirmed: binding.profileConfirmedAt !== null,
    })
    if (
      !sameGoogleContentAuthorizationVector(
        content.authorizationVector,
        expectedAuthorizationVector,
      )
    ) {
      return unavailable('policy_disabled', null)
    }
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
      approvalBindingId: content.approvalBindingId,
      authorizationVector,
      authorizationVectorSha256: providerAuthorizationVectorSha256({
        connectionLifecycleVersion: connection.lifecycleVersion,
        connectionAccessVersion: connection.accessVersion,
        credentialGeneration: connection.credentialGeneration,
        authorizationVector,
      }),
      principalHmacKeyVersion: principal.principalHmacKeyVersion,
      principalHmac: principal.principalHmac,
    })

    if (input.expected && !sameSnapshot(snapshot, input.expected)) {
      return staleSource()
    }
    if (input.phase === 'before_return' || input.requireAccessToken === false) {
      return { ok: true, snapshot, accessToken: null }
    }

    try {
      const accessToken = await deps.getAccessToken(actor.organizationId, connection.id)
      return { ok: true, snapshot, accessToken }
    } catch {
      return unavailable('integration_unavailable', null)
    }
  }
}
