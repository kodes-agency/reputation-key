import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  GoogleContentAuthorizationCheck,
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

export async function policyAuthorizes(
  tx: Database,
  capability: GoogleContentCapability,
  organizationId: string,
  propertyId: string | null,
): Promise<Readonly<{ version: number; emergencyKillVersion: number }> | null> {
  const result = await tx.execute(sql`
    SELECT pv.version, pv.emergency_kill_version
    FROM policy_version pv
    JOIN capability_execution_control control
      ON control.capability = ${capability}::google_content_capability
    WHERE pv.scope = 'global'
      AND control.denied = false
      AND control.emergency_kill_version = pv.emergency_kill_version
      AND NOT EXISTS (
        SELECT 1 FROM organization_policy policy
        WHERE policy.organization_id = ${organizationId}
          AND policy.suspended_at IS NOT NULL
      )
      AND EXISTS (
        SELECT 1 FROM organization_capability allowed
        WHERE allowed.organization_id = ${organizationId}
          AND allowed.capability = ${capability}
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
          AND EXISTS (
            SELECT 1 FROM property_capability allowed
            WHERE allowed.property_id = ${propertyId}::uuid
              AND allowed.capability = ${capability}
          )
        )
      )
    LIMIT 1
  `)
  const row = result.rows[0] as
    { version: number | string; emergency_kill_version: number | string } | undefined
  return row
    ? {
        version: Number(row.version),
        emergencyKillVersion: Number(row.emergency_kill_version),
      }
    : null
}

export const createGoogleContentAuthorizationCheck = (
  deps: GoogleContentAuthorizationCheckDeps,
): GoogleContentAuthorizationCheck<Database> => {
  return async (tx, input) => {
    if (!input.scope.connectionId) return deny()

    const systemReviewSync = input.capability === 'property.connect_gbp'
    const systemReplyPublication = input.capability === 'property.publish_reply'
    const oauthCredentialOperation =
      input.capability === 'property.import_gbp_v2' &&
      OAUTH_CREDENTIAL_OPERATIONS.has(input.operationKey)
    const oauthExchangeOperation =
      oauthCredentialOperation && OAUTH_EXCHANGE_OPERATIONS.has(input.operationKey)
    if (oauthCredentialOperation && input.scope.propertyId !== null) return deny()
    let principalVector: GoogleContentAuthorizationVector
    if (systemReviewSync) {
      const reviewOperation = REVIEW_SYNC_SYSTEM_OPERATIONS.has(input.operationKey)
      const notificationOperation = NOTIFICATION_SYSTEM_OPERATIONS.has(input.operationKey)
      if (
        input.scope.initiatorUserId !== null ||
        input.scope.propertyId === null ||
        (!reviewOperation && !notificationOperation)
      ) {
        return deny()
      }
      principalVector = Object.freeze({
        principalKind: 'system',
        systemPrincipal: notificationOperation
          ? GOOGLE_NOTIFICATION_SYSTEM_PRINCIPAL
          : GOOGLE_REVIEW_SYNC_SYSTEM_PRINCIPAL,
        role: 'System',
        permissionVersion: null,
        permissionDigest: notificationOperation
          ? GOOGLE_NOTIFICATION_SYSTEM_PERMISSION_DIGEST
          : GOOGLE_REVIEW_SYNC_SYSTEM_PERMISSION_DIGEST,
      })
    } else if (systemReplyPublication) {
      const publication = input.scope.publication
      if (
        input.scope.initiatorUserId !== null ||
        input.scope.propertyId === null ||
        !['reply.publish', 'provider.reviews.reply'].includes(input.operationKey) ||
        !publication ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          publication.reviewId,
        ) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          publication.replyId,
        ) ||
        !Number.isSafeInteger(publication.publicationCycle) ||
        publication.publicationCycle < 1 ||
        !Number.isSafeInteger(publication.attemptNumber) ||
        publication.attemptNumber < 1 ||
        !Number.isSafeInteger(publication.sourceEpoch) ||
        publication.sourceEpoch < 0 ||
        !Number.isSafeInteger(publication.materialReviewRevision) ||
        publication.materialReviewRevision < 1
      ) {
        return deny()
      }
      principalVector = Object.freeze({
        principalKind: 'system',
        systemPrincipal: GOOGLE_REPLY_PUBLICATION_SYSTEM_PRINCIPAL,
        role: 'System',
        permissionVersion: null,
        permissionDigest: GOOGLE_REPLY_PUBLICATION_SYSTEM_PERMISSION_DIGEST,
      })
    } else {
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
      if (!Number.isSafeInteger(permissionVersion) || permissionVersion < 0) {
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
      principalVector = Object.freeze({
        principalKind: 'user',
        role: actor.role,
        permissionVersion,
        permissionDigest: googleAuthorizationPermissionDigest(actor),
      })
    }

    const policy = await policyAuthorizes(
      tx,
      input.capability,
      input.scope.organizationId,
      input.scope.propertyId,
    )
    if (!policy) return deny()

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
    const connection = connectionResult.rows[0] as
      | {
          lifecycle_version: number
          access_version: number
          credential_generation: number
          status?: string
          credential_use_state?: string
          credential_home_cell_id?: string | null
          credential_home_policy_version?: number | null
          credential_home_authority_generation?: number | null
        }
      | undefined
    let oauthVector: GoogleContentAuthorizationVector = Object.freeze({})
    if (oauthExchangeOperation) {
      const homeResult = await tx.execute(sql`
        SELECT home_cell_id, catalogue_policy_version, authority_generation
        FROM google_organization_credential_homes
        WHERE organization_id = ${input.scope.organizationId}
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
        !Number.isSafeInteger(home.authority_generation) ||
        home.authority_generation < 1
      ) {
        return deny()
      }
      if (connection) {
        const legacyReconnect =
          connection.status === 'disconnected' &&
          connection.credential_use_state === 'none' &&
          connection.credential_home_cell_id == null &&
          connection.credential_home_policy_version == null &&
          connection.credential_home_authority_generation == null
        const exactExistingHome =
          connection.credential_home_cell_id === homeCell &&
          connection.credential_home_policy_version === home.catalogue_policy_version &&
          connection.credential_home_authority_generation === home.authority_generation
        if (!legacyReconnect && !exactExistingHome) return deny()
        oauthVector = Object.freeze({
          oauthCredentialOperation: 'exchange_existing',
          connectionStatus: connection.status ?? null,
          credentialUseState: connection.credential_use_state ?? null,
          credentialHomeCellId: homeCell,
          credentialHomePolicyVersion: home.catalogue_policy_version,
          credentialHomeAuthorityGeneration: home.authority_generation,
        })
      } else {
        oauthVector = Object.freeze({
          oauthCredentialOperation: 'exchange_new',
          connectionLifecycleVersion: 0,
          connectionAccessVersion: 0,
          credentialGeneration: 0,
          credentialHomeCellId: homeCell,
          credentialHomePolicyVersion: home.catalogue_policy_version,
          credentialHomeAuthorityGeneration: home.authority_generation,
        })
      }
    } else if (!connection) {
      return deny()
    }
    let propertyVector: GoogleContentAuthorizationVector = Object.freeze({})
    if (input.scope.propertyId !== null) {
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
      propertyVector = Object.freeze({
        propertySourceEpoch: Number(property.source_epoch),
        propertyProfileVersion: Number(property.profile_version),
        propertyBindingState: property.google_binding_state,
        propertyLifecycleState: property.lifecycle_state,
        propertyProfileSource: property.profile_source,
        propertyTimezoneConfirmed: property.profile_confirmed_at !== null,
      })
    }

    let publicationVector: GoogleContentAuthorizationVector = Object.freeze({})
    if (systemReplyPublication) {
      const publication = input.scope.publication!
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
      const publicationRow = publicationResult.rows[0] as
        | {
            reply_state_revision: number | string
            base_observation_revision: number | string
            expected_reply_digest: string
            authorized_by_user_id: string
            confirming_member_role: string
            confirming_permission_version: number | string
          }
        | undefined
      if (!publicationRow) return deny()
      const permissionVersion = Number(publicationRow.confirming_permission_version)
      const replyStateRevision = Number(publicationRow.reply_state_revision)
      const baseObservationRevision = Number(publicationRow.base_observation_revision)
      if (
        !Number.isSafeInteger(permissionVersion) ||
        permissionVersion < 0 ||
        !Number.isSafeInteger(replyStateRevision) ||
        replyStateRevision < 1 ||
        !Number.isSafeInteger(baseObservationRevision) ||
        baseObservationRevision < 0 ||
        !/^[a-f0-9]{64}$/u.test(publicationRow.expected_reply_digest)
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
      publicationVector = Object.freeze({
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
      })
    }

    return {
      allowed: true,
      vector: {
        executionPolicyVersion: GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
        googleContentPolicyVersion: policy.version,
        emergencyKillVersion: policy.emergencyKillVersion,
        ...principalVector,
        connectionLifecycleVersion: connection ? Number(connection.lifecycle_version) : 0,
        connectionAccessVersion: connection ? Number(connection.access_version) : 0,
        credentialGeneration: connection ? Number(connection.credential_generation) : 0,
        ...oauthVector,
        ...propertyVector,
        ...publicationVector,
      },
    }
  }
}
