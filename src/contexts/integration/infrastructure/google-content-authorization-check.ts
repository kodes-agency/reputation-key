import { sql } from 'drizzle-orm'
import { isCoreCapability } from '#/shared/auth/beta-capabilities'
import type { Database } from '#/shared/db'
import type {
  GoogleContentAuthorizationCheck,
  GoogleContentAuthorizationScope,
  GoogleContentAuthorizationVector,
} from '#/shared/auth/google-content-authority'
import {
  GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
  type GoogleContentCapability,
} from '#/shared/auth/google-content-contract'
import { resolveMemberAuthContextWithDatabase } from '#/shared/auth/tenant-resolver'
import { googleAuthorizationPermissionDigest } from '#/shared/domain/google-content-authorization-vector'
import {
  GOOGLE_NOTIFICATION_SYSTEM_PERMISSION_DIGEST,
  GOOGLE_NOTIFICATION_SYSTEM_PRINCIPAL,
  GOOGLE_REVIEW_SYNC_SYSTEM_PERMISSION_DIGEST,
  GOOGLE_REVIEW_SYNC_SYSTEM_PRINCIPAL,
} from '../application/google-review-sync-authorizer'
import {
  GOOGLE_REPLY_PUBLICATION_SYSTEM_PERMISSION_DIGEST,
  GOOGLE_REPLY_PUBLICATION_SYSTEM_PRINCIPAL,
} from '../application/google-reply-publication-authorizer'
import {
  canForContext,
  scopeForPermission,
  type Permission,
} from '#/shared/domain/permissions'
import {
  DATA_CELL_CATALOGUE_POLICY_VERSION,
  dataCellById,
} from '#/shared/domain/data-cell-catalogue'
type GoogleContentAuthorizationCheckDeps = Readonly<{
  clock: () => Date
  hasActivePropertyGrant: (
    tx: Database,
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      at: Date
    }>,
  ) => Promise<boolean>
}>

const deny = (code = 'authorization_denied') => ({ allowed: false as const, code })

type AuthorizationInput = Parameters<GoogleContentAuthorizationCheck<Database>>[1]

/**
 * Every stage of the check either denies (and that denial is the whole
 * decision) or contributes one slice of the authorization vector.
 */
type VectorStage =
  | ReturnType<typeof deny>
  | Readonly<{ allowed: true; value: GoogleContentAuthorizationVector }>

const stageVector = (value: GoogleContentAuthorizationVector): VectorStage => ({
  allowed: true,
  value,
})

const EMPTY_VECTOR_STAGE = stageVector(Object.freeze({}))

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/u

const isCountFrom = (value: number, minimum: number) =>
  Number.isSafeInteger(value) && value >= minimum

const REVIEW_SYNC_SYSTEM_OPERATIONS = new Set([
  'review.sync',
  'provider.reviews.list',
  'provider.reviews.get',
])
const NOTIFICATION_SYSTEM_OPERATIONS = new Set([
  'notifications.manage',
  'provider.notifications.get',
  'provider.notifications.subscribe',
  'provider.notifications.unsubscribe',
])
const OAUTH_CREDENTIAL_OPERATIONS = new Set([
  'oauth.token.exchange',
  'provider.oauth.token.exchange',
  'oauth.token.refresh',
  'provider.oauth.token.refresh',
  'oauth.revoke',
  'provider.oauth.revoke',
])
const OAUTH_EXCHANGE_OPERATIONS = new Set([
  'oauth.token.exchange',
  'provider.oauth.token.exchange',
])
const REPLY_PUBLICATION_OPERATIONS = ['reply.publish', 'provider.reviews.reply']

/**
 * Whether policy currently authorizes this Google content capability.
 *
 * CORE capabilities are exempt from the two ALLOWLIST clauses, and only those.
 * `checkScopedCapability` has always treated them that way — a core capability
 * is part of the product rather than something a cohort opts into — and nothing
 * in the product ever writes an `organization_capability` row for one. Requiring
 * those rows here meant `property.connect_gbp` and `property.publish_reply`
 * could never authorize for ANY tenant, so review sync and reply publication
 * were dead everywhere, not just in the test stack. The two gates disagreed and
 * this one was the odd one out.
 *
 * Everything else still applies to core capabilities exactly as before: the
 * global kill switch (`capability_execution_control.denied` and the emergency
 * kill version), organization suspension, property suspension, and the property
 * belonging to the organization and not being deleted.
 */
export async function policyAuthorizes(
  tx: Database,
  capability: GoogleContentCapability,
  organizationId: string,
  propertyId: string | null,
): Promise<boolean> {
  const allowlistExempt = isCoreCapability(capability)
  // WP2.2: the `policy_version` generation and `capability_execution_control`
  // kill switch were the approval control plane and are gone. What is left is
  // the product's own authority to make the call at all: the organization is
  // not suspended, it holds the capability unless the capability is core, and
  // — when the call names a Property — that Property exists, belongs to the
  // organization, is not deleted, is not suspended, and holds the capability.
  const result = await tx.execute(sql`
    SELECT 1
    WHERE NOT EXISTS (
        SELECT 1 FROM organization_policy policy
        WHERE policy.organization_id = ${organizationId}
          AND policy.suspended_at IS NOT NULL
      )
      AND (
        ${allowlistExempt}
        OR EXISTS (
          SELECT 1 FROM organization_capability allowed
          WHERE allowed.organization_id = ${organizationId}
            AND allowed.capability = ${capability}
        )
      )
      AND (
        ${propertyId}::uuid IS NULL
        OR (
          EXISTS (
            SELECT 1 FROM properties property
            WHERE property.id = ${propertyId}::uuid
              AND property.organization_id = ${organizationId}
              AND property.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM property_policy policy
            WHERE policy.property_id = ${propertyId}::uuid
              AND policy.suspended_at IS NOT NULL
          )
          AND (
            ${allowlistExempt}
            OR EXISTS (
              SELECT 1 FROM property_capability allowed
              WHERE allowed.property_id = ${propertyId}::uuid
                AND allowed.capability = ${capability}
            )
          )
        )
      )
    LIMIT 1
  `)
  return result.rows.length > 0
}

/**
 * Which of the three mutually exclusive principal shapes the request takes, plus
 * the two OAuth-credential flags derived from the capability/operation pair.
 */
type RequestShape = Readonly<{
  systemReviewSync: boolean
  systemReplyPublication: boolean
  oauthCredentialOperation: boolean
  oauthExchangeOperation: boolean
}>

const classifyRequest = (input: AuthorizationInput): RequestShape => {
  const oauthCredentialOperation =
    input.capability === 'property.import_gbp_v2' &&
    OAUTH_CREDENTIAL_OPERATIONS.has(input.operationKey)
  return {
    systemReviewSync: input.capability === 'property.connect_gbp',
    systemReplyPublication: input.capability === 'property.publish_reply',
    oauthCredentialOperation,
    oauthExchangeOperation:
      oauthCredentialOperation && OAUTH_EXCHANGE_OPERATIONS.has(input.operationKey),
  }
}

const resolveReviewSyncPrincipal = (input: AuthorizationInput): VectorStage => {
  const reviewOperation = REVIEW_SYNC_SYSTEM_OPERATIONS.has(input.operationKey)
  const notificationOperation = NOTIFICATION_SYSTEM_OPERATIONS.has(input.operationKey)
  if (
    input.scope.initiatorUserId !== null ||
    input.scope.propertyId === null ||
    (!reviewOperation && !notificationOperation)
  ) {
    return deny()
  }
  return stageVector(
    Object.freeze({
      principalKind: 'system',
      systemPrincipal: notificationOperation
        ? GOOGLE_NOTIFICATION_SYSTEM_PRINCIPAL
        : GOOGLE_REVIEW_SYNC_SYSTEM_PRINCIPAL,
      role: 'System',
      permissionVersion: null,
      permissionDigest: notificationOperation
        ? GOOGLE_NOTIFICATION_SYSTEM_PERMISSION_DIGEST
        : GOOGLE_REVIEW_SYNC_SYSTEM_PERMISSION_DIGEST,
    }),
  )
}

const isWellFormedPublicationScope = (
  publication: NonNullable<GoogleContentAuthorizationScope['publication']>,
): boolean =>
  UUID_PATTERN.test(publication.reviewId) &&
  UUID_PATTERN.test(publication.replyId) &&
  isCountFrom(publication.publicationCycle, 1) &&
  isCountFrom(publication.attemptNumber, 1) &&
  isCountFrom(publication.sourceEpoch, 0) &&
  isCountFrom(publication.materialReviewRevision, 1)

const resolveReplyPublicationPrincipal = (input: AuthorizationInput): VectorStage => {
  const publication = input.scope.publication
  if (
    input.scope.initiatorUserId !== null ||
    input.scope.propertyId === null ||
    !REPLY_PUBLICATION_OPERATIONS.includes(input.operationKey) ||
    !publication ||
    !isWellFormedPublicationScope(publication)
  ) {
    return deny()
  }
  return stageVector(
    Object.freeze({
      principalKind: 'system',
      systemPrincipal: GOOGLE_REPLY_PUBLICATION_SYSTEM_PRINCIPAL,
      role: 'System',
      permissionVersion: null,
      permissionDigest: GOOGLE_REPLY_PUBLICATION_SYSTEM_PERMISSION_DIGEST,
    }),
  )
}

const resolveUserPrincipal = async (
  tx: Database,
  input: AuthorizationInput,
  deps: GoogleContentAuthorizationCheckDeps,
  oauthCredentialOperation: boolean,
): Promise<VectorStage> => {
  if (!input.scope.initiatorUserId) return deny()
  if (
    input.capability === 'property.read_gbp_performance' &&
    input.scope.propertyId === null
  ) {
    return deny()
  }

  const memberResult = await tx.execute(sql`
    SELECT member.role, permission.version AS permission_version
    FROM member
    JOIN permission_version AS permission
      ON permission.organization_id = member."organizationId"
    WHERE member."organizationId" = ${input.scope.organizationId}
      AND member."userId" = ${input.scope.initiatorUserId}
    LIMIT 1
  `)
  const member = memberResult.rows[0] as
    { role: string; permission_version: number | string } | undefined
  if (!member) return deny()
  const permissionVersion = Number(member.permission_version)
  if (!isCountFrom(permissionVersion, 0)) {
    return deny('authorization_unavailable')
  }

  let actor
  try {
    actor = (
      await resolveMemberAuthContextWithDatabase(tx, {
        memberRole: member.role,
        organizationId: input.scope.organizationId,
        userId: input.scope.initiatorUserId,
      })
    ).context
  } catch {
    return deny('authorization_unavailable')
  }
  const permission = oauthCredentialOperation
    ? ('integration.manage' as const)
    : (input.capability as Permission)
  if (!canForContext(actor, permission)) return deny()
  const scope = scopeForPermission(actor, permission)
  if (scope === 'none') return deny()
  if (input.capability === 'property.import_gbp_v2' && scope !== 'organization') {
    return deny()
  }
  if (scope === 'assigned-properties' && input.scope.propertyId) {
    const hasGrant = await deps.hasActivePropertyGrant(tx, {
      organizationId: input.scope.organizationId,
      propertyId: input.scope.propertyId,
      userId: input.scope.initiatorUserId,
      at: deps.clock(),
    })
    if (!hasGrant) return deny()
  }
  return stageVector(
    Object.freeze({
      principalKind: 'user',
      role: actor.role,
      permissionVersion,
      permissionDigest: googleAuthorizationPermissionDigest(actor),
    }),
  )
}

const resolvePrincipalVector = (
  tx: Database,
  input: AuthorizationInput,
  deps: GoogleContentAuthorizationCheckDeps,
  shape: RequestShape,
): VectorStage | Promise<VectorStage> => {
  if (shape.systemReviewSync) return resolveReviewSyncPrincipal(input)
  if (shape.systemReplyPublication) return resolveReplyPublicationPrincipal(input)
  return resolveUserPrincipal(tx, input, deps, shape.oauthCredentialOperation)
}

type ConnectionRow = Readonly<{
  lifecycle_version: number
  access_version: number
  credential_generation: number
  status?: string
  credential_use_state?: string
  credential_home_cell_id?: string | null
  credential_home_policy_version?: number | null
  credential_home_authority_generation?: number | null
}>

const loadConnection = async (
  tx: Database,
  input: AuthorizationInput,
  oauthExchangeOperation: boolean,
): Promise<ConnectionRow | undefined> => {
  const connectionResult = await tx.execute(
    oauthExchangeOperation
      ? sql`
          SELECT lifecycle_version, access_version, credential_generation,
                 status, credential_use_state, credential_home_cell_id,
                 credential_home_policy_version,
                 credential_home_authority_generation
          FROM google_connections
          WHERE id = ${input.scope.connectionId}::uuid
            AND organization_id = ${input.scope.organizationId}
            AND status IN ('active', 'degraded', 'reauth_required', 'disconnected')
            AND credential_use_state IN ('active', 'none')
          LIMIT 1
        `
      : sql`
          SELECT lifecycle_version, access_version, credential_generation
          FROM google_connections
          WHERE id = ${input.scope.connectionId}::uuid
            AND organization_id = ${input.scope.organizationId}
            AND status = 'active'
            AND credential_use_state = 'active'
          LIMIT 1
        `,
  )
  return connectionResult.rows[0] as ConnectionRow | undefined
}

type CredentialHome = Readonly<{
  homeCell: string
  policyVersion: number
  authorityGeneration: number
}>

/** Returns the single unsuperseded Organization credential home, or null when it
 * is missing, ambiguous, unknown to the catalogue, or catalogue-stale. */
const loadCredentialHome = async (
  tx: Database,
  organizationId: string,
): Promise<CredentialHome | null> => {
  const homeResult = await tx.execute(sql`
    SELECT home_cell_id, catalogue_policy_version, authority_generation
    FROM google_organization_credential_homes
    WHERE organization_id = ${organizationId}
      AND superseded_at IS NULL
    LIMIT 2
  `)
  const home = homeResult.rows[0] as
    | {
        home_cell_id: string
        catalogue_policy_version: number
        authority_generation: number
      }
    | undefined
  const homeCell = home ? dataCellById(home.home_cell_id)?.id : undefined
  if (
    homeResult.rows.length !== 1 ||
    !home ||
    !homeCell ||
    home.catalogue_policy_version !== DATA_CELL_CATALOGUE_POLICY_VERSION ||
    !isCountFrom(home.authority_generation, 1)
  ) {
    return null
  }
  return {
    homeCell,
    policyVersion: home.catalogue_policy_version,
    authorityGeneration: home.authority_generation,
  }
}

const isLegacyReconnectTarget = (connection: ConnectionRow): boolean =>
  connection.status === 'disconnected' &&
  connection.credential_use_state === 'none' &&
  connection.credential_home_cell_id == null &&
  connection.credential_home_policy_version == null &&
  connection.credential_home_authority_generation == null

const matchesCredentialHome = (
  connection: ConnectionRow,
  home: CredentialHome,
): boolean =>
  connection.credential_home_cell_id === home.homeCell &&
  connection.credential_home_policy_version === home.policyVersion &&
  connection.credential_home_authority_generation === home.authorityGeneration

const resolveOauthExchangeVector = async (
  tx: Database,
  input: AuthorizationInput,
  connection: ConnectionRow | undefined,
): Promise<VectorStage> => {
  const home = await loadCredentialHome(tx, input.scope.organizationId)
  if (!home) return deny()
  if (!connection) {
    return stageVector(
      Object.freeze({
        oauthCredentialOperation: 'exchange_new',
        connectionLifecycleVersion: 0,
        connectionAccessVersion: 0,
        credentialGeneration: 0,
        credentialHomeCellId: home.homeCell,
        credentialHomePolicyVersion: home.policyVersion,
        credentialHomeAuthorityGeneration: home.authorityGeneration,
      }),
    )
  }
  if (!isLegacyReconnectTarget(connection) && !matchesCredentialHome(connection, home)) {
    return deny()
  }
  return stageVector(
    Object.freeze({
      oauthCredentialOperation: 'exchange_existing',
      connectionStatus: connection.status ?? null,
      credentialUseState: connection.credential_use_state ?? null,
      credentialHomeCellId: home.homeCell,
      credentialHomePolicyVersion: home.policyVersion,
      credentialHomeAuthorityGeneration: home.authorityGeneration,
    }),
  )
}

const resolveOauthVector = (
  tx: Database,
  input: AuthorizationInput,
  oauthExchangeOperation: boolean,
  connection: ConnectionRow | undefined,
): VectorStage | Promise<VectorStage> => {
  if (oauthExchangeOperation) return resolveOauthExchangeVector(tx, input, connection)
  return connection ? EMPTY_VECTOR_STAGE : deny()
}

const connectionVersionVector = (
  connection: ConnectionRow | undefined,
): GoogleContentAuthorizationVector => ({
  connectionLifecycleVersion: connection ? Number(connection.lifecycle_version) : 0,
  connectionAccessVersion: connection ? Number(connection.access_version) : 0,
  credentialGeneration: connection ? Number(connection.credential_generation) : 0,
})

const resolvePropertyVector = async (
  tx: Database,
  input: AuthorizationInput,
): Promise<VectorStage> => {
  const propertyResult = await tx.execute(sql`
    SELECT
      source_epoch,
      profile_version,
      google_binding_state,
      lifecycle_state,
      profile_source,
      profile_confirmed_at
    FROM properties
    WHERE id = ${input.scope.propertyId}::uuid
      AND organization_id = ${input.scope.organizationId}
      AND google_connection_id = ${input.scope.connectionId}::uuid
      AND gbp_location_id IS NOT NULL
      AND deleted_at IS NULL
      AND lifecycle_state = 'active'
      AND google_binding_state = 'active'
    LIMIT 1
  `)
  const property = propertyResult.rows[0] as
    | {
        source_epoch: number
        profile_version: number
        google_binding_state: string
        lifecycle_state: string
        profile_source: string
        profile_confirmed_at: Date | string | null
      }
    | undefined
  if (
    !property ||
    (input.capability === 'property.read_gbp_performance' &&
      (property.profile_source !== 'tenant_confirmed' ||
        property.profile_confirmed_at === null))
  ) {
    return deny()
  }
  return stageVector(
    Object.freeze({
      propertySourceEpoch: Number(property.source_epoch),
      propertyProfileVersion: Number(property.profile_version),
      propertyBindingState: property.google_binding_state,
      propertyLifecycleState: property.lifecycle_state,
      propertyProfileSource: property.profile_source,
      propertyTimezoneConfirmed: property.profile_confirmed_at !== null,
    }),
  )
}

type PublicationRow = Readonly<{
  reply_state_revision: number | string
  base_observation_revision: number | string
  expected_reply_digest: string
  authorized_by_user_id: string
  confirming_member_role: string
  confirming_permission_version: number | string
}>

const loadPublicationAttempt = async (
  tx: Database,
  input: AuthorizationInput,
  publication: NonNullable<GoogleContentAuthorizationScope['publication']>,
): Promise<PublicationRow | undefined> => {
  const publicationResult = await tx.execute(sql`
    SELECT
      attempt.reply_state_revision,
      attempt.base_observation_revision,
      attempt.expected_reply_digest,
      publication_authorization.authorized_by_user_id,
      confirming_member.role AS confirming_member_role,
      confirming_permission.version AS confirming_permission_version
    FROM reply_publication_attempts AS attempt
    INNER JOIN reply_publication_authorizations AS publication_authorization
      ON publication_authorization.organization_id = attempt.organization_id
     AND publication_authorization.property_id = attempt.property_id
     AND publication_authorization.review_id = attempt.review_id
     AND publication_authorization.reply_id = attempt.reply_id
     AND publication_authorization.publication_cycle = attempt.publication_cycle
     AND publication_authorization.source_epoch = attempt.source_epoch
     AND publication_authorization.material_review_revision = attempt.material_review_revision
     AND publication_authorization.reply_state_revision = attempt.reply_state_revision
     AND publication_authorization.normalization_version = attempt.normalization_version
     AND publication_authorization.expected_reply_digest = attempt.expected_reply_digest
    INNER JOIN replies AS reply
      ON reply.organization_id = attempt.organization_id
     AND reply.review_id = attempt.review_id
     AND reply.id = attempt.reply_id
    INNER JOIN reviews AS review
      ON review.organization_id = attempt.organization_id
     AND review.property_id = attempt.property_id
     AND review.id = attempt.review_id
    INNER JOIN member AS confirming_member
      ON confirming_member."organizationId" = publication_authorization.organization_id
     AND confirming_member."userId" = publication_authorization.authorized_by_user_id
    INNER JOIN permission_version AS confirming_permission
      ON confirming_permission.organization_id = publication_authorization.organization_id
    WHERE attempt.organization_id = ${input.scope.organizationId}
      AND attempt.property_id = ${input.scope.propertyId}::uuid
      AND attempt.review_id = ${publication.reviewId}::uuid
      AND attempt.reply_id = ${publication.replyId}::uuid
      AND attempt.publication_cycle = ${publication.publicationCycle}
      AND attempt.attempt_number = ${publication.attemptNumber}
      AND attempt.source_epoch = ${publication.sourceEpoch}
      AND attempt.material_review_revision = ${publication.materialReviewRevision}
      AND attempt.outcome = 'sending'
      AND reply.status = 'approved'
      AND reply.publication_state = 'sending'
      AND reply.publication_cycle = attempt.publication_cycle
      AND reply.publication_attempts = attempt.attempt_number
      AND review.google_connection_id = ${input.scope.connectionId}::uuid
      AND review.source_content_state = 'active'
      AND review.source_epoch = attempt.source_epoch
      AND review.source_revision = attempt.material_review_revision
    LIMIT 1
  `)
  return publicationResult.rows[0] as PublicationRow | undefined
}

const resolvePublicationVector = async (
  tx: Database,
  input: AuthorizationInput,
  deps: GoogleContentAuthorizationCheckDeps,
): Promise<VectorStage> => {
  const publication = input.scope.publication!
  const publicationRow = await loadPublicationAttempt(tx, input, publication)
  if (!publicationRow) return deny()
  const permissionVersion = Number(publicationRow.confirming_permission_version)
  const replyStateRevision = Number(publicationRow.reply_state_revision)
  const baseObservationRevision = Number(publicationRow.base_observation_revision)
  if (
    !isCountFrom(permissionVersion, 0) ||
    !isCountFrom(replyStateRevision, 1) ||
    !isCountFrom(baseObservationRevision, 0) ||
    !SHA256_PATTERN.test(publicationRow.expected_reply_digest)
  ) {
    return deny('authorization_unavailable')
  }

  let confirmingActor
  try {
    confirmingActor = (
      await resolveMemberAuthContextWithDatabase(tx, {
        memberRole: publicationRow.confirming_member_role,
        organizationId: input.scope.organizationId,
        userId: publicationRow.authorized_by_user_id,
      })
    ).context
  } catch {
    return deny('authorization_unavailable')
  }
  if (!canForContext(confirmingActor, 'reply.manage')) {
    return deny()
  }
  const confirmingScope = scopeForPermission(confirmingActor, 'reply.manage')
  if (confirmingScope === 'none') return deny()
  if (
    confirmingScope === 'assigned-properties' &&
    !(await deps.hasActivePropertyGrant(tx, {
      organizationId: input.scope.organizationId,
      propertyId: input.scope.propertyId!,
      userId: publicationRow.authorized_by_user_id,
      at: deps.clock(),
    }))
  ) {
    return deny()
  }
  return stageVector(
    Object.freeze({
      confirmingActorUserId: publicationRow.authorized_by_user_id,
      confirmingActorRole: confirmingActor.role,
      confirmingActorPermissionVersion: permissionVersion,
      reviewId: publication.reviewId,
      replyId: publication.replyId,
      publicationCycle: publication.publicationCycle,
      publicationAttemptNumber: publication.attemptNumber,
      materialReviewRevision: publication.materialReviewRevision,
      replyStateRevision,
      baseObservationRevision,
      expectedReplyDigest: publicationRow.expected_reply_digest,
    }),
  )
}

export const createGoogleContentAuthorizationCheck = (
  deps: GoogleContentAuthorizationCheckDeps,
): GoogleContentAuthorizationCheck<Database> => {
  return async (tx, input) => {
    if (!input.scope.connectionId) return deny()

    const shape = classifyRequest(input)
    if (shape.oauthCredentialOperation && input.scope.propertyId !== null) return deny()

    const principal = await resolvePrincipalVector(tx, input, deps, shape)
    if (!principal.allowed) return principal

    const policyAllows = await policyAuthorizes(
      tx,
      input.capability,
      input.scope.organizationId,
      input.scope.propertyId,
    )
    if (!policyAllows) return deny()

    const connection = await loadConnection(tx, input, shape.oauthExchangeOperation)
    const oauth = await resolveOauthVector(
      tx,
      input,
      shape.oauthExchangeOperation,
      connection,
    )
    if (!oauth.allowed) return oauth

    const property =
      input.scope.propertyId === null
        ? EMPTY_VECTOR_STAGE
        : await resolvePropertyVector(tx, input)
    if (!property.allowed) return property

    const publicationStage = shape.systemReplyPublication
      ? await resolvePublicationVector(tx, input, deps)
      : EMPTY_VECTOR_STAGE
    if (!publicationStage.allowed) return publicationStage

    return {
      allowed: true,
      vector: {
        // `googleContentPolicyVersion` and `emergencyKillVersion` used to ride
        // here so the permit SQL could compare them against the approval
        // control plane. That comparison is gone, so carrying the values would
        // be carrying a number nothing reads.
        executionPolicyVersion: GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
        ...principal.value,
        ...connectionVersionVector(connection),
        ...oauth.value,
        ...property.value,
        ...publicationStage.value,
      },
    }
  }
}
