import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { googleReplyTextDigest } from '#/shared/domain/google-reply-text'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/shared/testing/google-provider-identifiers-v1'
import {
  admissionBindings,
  currentPermissionVersion,
  insertActiveGoogleProperty,
  insertAdminMember,
  insertAdmittedPermit,
  insertOperatorPropertyGrant,
  withCapabilityOpen,
} from '#/shared/testing/google-permit-seed'
import {
  ACTIVE_PROPERTY_VECTOR,
  CONNECTION_ID,
  ORGANIZATION_ID,
  PERMIT_ID,
  USER_ID,
  authority,
  compiledOAuthExchange,
  compiledPerformance,
  compiledReply,
  compiledReviewList,
  harness,
  loadSnapshot,
  readPermit,
  usePermitAuthorityHarness,
} from '#/shared/testing/postgres-permit-authority.test-fixtures'

usePermitAuthorityHarness()

const OPERATION_MS_COLUMNS =
  'state, EXTRACT(EPOCH FROM (operation_deadline_at - started_at)) * 1000 AS operation_ms'

describe('Postgres Google admission permit authority', () => {
  it('loads persisted scope dimensions and starts exactly one permit generation', async () => {
    const adapter = authority()
    const snapshot = await loadSnapshot(PERMIT_ID)

    expect(snapshot.quotaKey).toMatchObject({
      organizationId: ORGANIZATION_ID,
      initiatorUserId: USER_ID,
      connectionId: CONNECTION_ID,
      propertyId: null,
      endpointClass: 'account-management',
    })
    await expect(adapter.start(snapshot)).resolves.toBe('started')
    await expect(adapter.start(snapshot)).resolves.toBe('changed')
    const row = await readPermit(PERMIT_ID, OPERATION_MS_COLUMNS)
    expect(row?.state).toBe('started')
    expect(Number(row?.operation_ms)).toBe(30_000)
  })

  it('expires an admitted permit after its start deadline', async () => {
    await harness.pool.query(
      `UPDATE authorization_execution_permits
          SET admitted_at = clock_timestamp() - interval '2 seconds',
              start_deadline_at = clock_timestamp() - interval '1 second'
        WHERE id = $1`,
      [PERMIT_ID],
    )
    const snapshot = await loadSnapshot(PERMIT_ID, 'expired permit snapshot')

    await expect(authority().start(snapshot)).resolves.toBe('expired')
    expect(await readPermit(PERMIT_ID, 'state, correlation_id')).toEqual({
      state: 'fenced',
      correlation_id: 'start_deadline_elapsed',
    })
  })

  it('does not start when exact request authorization metadata drifts', async () => {
    const snapshot = await loadSnapshot(PERMIT_ID)
    await harness.pool.query(
      `UPDATE authorization_execution_permits
          SET authorization_vector = jsonb_set(
            authorization_vector,
            '{requestBodyBytes}',
            '1'::jsonb
          )
        WHERE id = $1`,
      [PERMIT_ID],
    )

    await expect(authority().start(snapshot)).resolves.toBe('changed')
    expect((await readPermit(PERMIT_ID, 'state'))?.state).toBe('admitted')
  })

  it('does not accept a sparse provider binding through the database API', async () => {
    const snapshot = await loadSnapshot(PERMIT_ID)
    const result = await harness.pool.query<{ outcome: string }>(
      `SELECT outcome FROM start_google_execution_permit(
        $1::uuid, $2::text, $3::text, $4::text, '{}'::jsonb
      )`,
      [
        snapshot.permitId,
        snapshot.routeKey,
        snapshot.routeCatalogueVersion,
        snapshot.expectedAdmission.quotaPolicyId,
      ],
    )

    expect(result.rows[0]?.outcome).toBe('changed')
    expect((await readPermit(PERMIT_ID, 'state'))?.state).toBe('admitted')
  })

  it('starts a prospective OAuth exchange exactly once under concurrency', async () => {
    const { pool } = harness
    const permitId = randomUUID()
    try {
      await insertAdmittedPermit(pool, {
        id: permitId,
        capability: 'property.import_gbp_v2',
        organizationId: ORGANIZATION_ID,
        connectionId: randomUUID(),
        initiatorUserId: USER_ID,
        operationKey: 'provider.oauth.token.exchange',
        compiled: compiledOAuthExchange,
        vector: {
          executionPolicyVersion: 'beta-local-2',
          principalKind: 'user',
          role: 'AccountAdmin',
          permissionVersion: await currentPermissionVersion(pool, ORGANIZATION_ID),
          permissionDigest: 'd'.repeat(64),
          oauthCredentialOperation: 'exchange_new',
          connectionLifecycleVersion: 0,
          connectionAccessVersion: 0,
          credentialGeneration: 0,
          ...admissionBindings(compiledOAuthExchange),
        },
      })

      const adapter = authority()
      const snapshot = await loadSnapshot(permitId, 'prospective exchange permit')
      const outcomes = await Promise.all([
        adapter.start(snapshot),
        adapter.start(snapshot),
      ])
      expect(outcomes.sort()).toEqual(['changed', 'started'])
      const row = await readPermit(permitId, OPERATION_MS_COLUMNS)
      expect(row).toMatchObject({ state: 'started' })
      expect(Number(row?.operation_ms)).toBe(30_000)
    } finally {
      await pool.query('DELETE FROM authorization_execution_permits WHERE id = $1', [
        permitId,
      ])
    }
  })

  it('fences a human permit when the permission generation advances', async () => {
    const snapshot = await loadSnapshot(PERMIT_ID)
    await harness.pool.query(
      `UPDATE permission_version
          SET version = version + 1, updated_at = now()
        WHERE organization_id = $1`,
      [ORGANIZATION_ID],
    )

    await expect(authority().start(snapshot)).resolves.toBe('changed')
    expect(await readPermit(PERMIT_ID, 'state, correlation_id')).toEqual({
      state: 'fenced',
      correlation_id: 'authorization_changed',
    })
  })

  it('starts system review sync without connector-user authority', async () => {
    const { pool } = harness
    const property = randomUUID()
    const permitId = randomUUID()
    await withCapabilityOpen(pool, 'property.connect_gbp', async () => {
      try {
        await insertActiveGoogleProperty(pool, {
          id: property,
          organizationId: ORGANIZATION_ID,
          connectionId: CONNECTION_ID,
          name: 'Review sync property',
          confirmedBy: USER_ID,
        })
        await insertAdmittedPermit(pool, {
          id: permitId,
          capability: 'property.connect_gbp',
          organizationId: ORGANIZATION_ID,
          propertyId: property,
          connectionId: CONNECTION_ID,
          initiatorUserId: null,
          operationKey: 'provider.reviews.list',
          compiled: compiledReviewList,
          vector: {
            executionPolicyVersion: 'beta-local-2',
            principalKind: 'system',
            systemPrincipal: 'review-sync-worker-v1',
            role: 'System',
            permissionVersion: null,
            permissionDigest:
              '65da4b7ff2904448056791e99cea6bcf83adee8507a501d9b22d042d41373899',
            connectionLifecycleVersion: 1,
            connectionAccessVersion: 1,
            credentialGeneration: 1,
            ...ACTIVE_PROPERTY_VECTOR,
            ...admissionBindings(compiledReviewList),
          },
        })

        const snapshot = await loadSnapshot(permitId, 'review sync permit snapshot')
        expect(snapshot.quotaKey.initiatorUserId).toBeNull()
        await expect(authority().start(snapshot)).resolves.toBe('started')
      } finally {
        await pool.query('DELETE FROM authorization_execution_permits WHERE id = $1', [
          permitId,
        ])
        await pool.query('DELETE FROM properties WHERE id = $1', [property])
      }
    })
  })

  it('starts only the current durable reply-publication attempt under live manager authority', async () => {
    const { pool } = harness
    const property = randomUUID()
    const reviewId = randomUUID()
    const replyId = randomUUID()
    const managerUser = `publication-manager-${randomUUID()}`
    const managerMember = `publication-member-${randomUUID()}`
    const authorizationDigest = googleReplyTextDigest('Thank you for your review.')
    const permitIds: string[] = []
    const seedPublicationPermit = async (
      overrides: Readonly<Record<string, string | number | boolean | null>> = {},
    ) => {
      const permitId = randomUUID()
      permitIds.push(permitId)
      await insertAdmittedPermit(pool, {
        id: permitId,
        capability: 'property.publish_reply',
        organizationId: ORGANIZATION_ID,
        propertyId: property,
        connectionId: CONNECTION_ID,
        initiatorUserId: null,
        operationKey: 'provider.reviews.reply',
        compiled: compiledReply,
        vector: {
          executionPolicyVersion: 'beta-local-2',
          principalKind: 'system',
          systemPrincipal: 'reply-publication-worker-v1',
          role: 'System',
          permissionVersion: null,
          permissionDigest:
            '78f5439a163ad5264b40a99b8d1b02d3fe433b47ea838049ae5806d10b8bbfe3',
          confirmingActorUserId: managerUser,
          confirmingActorRole: 'PropertyManager',
          confirmingActorPermissionVersion: await currentPermissionVersion(
            pool,
            ORGANIZATION_ID,
          ),
          connectionLifecycleVersion: 1,
          connectionAccessVersion: 1,
          credentialGeneration: 1,
          ...ACTIVE_PROPERTY_VECTOR,
          reviewId,
          replyId,
          publicationCycle: 3,
          publicationAttemptNumber: 2,
          materialReviewRevision: 9,
          replyStateRevision: 1,
          baseObservationRevision: 4,
          expectedReplyDigest: authorizationDigest,
          ...admissionBindings(compiledReply),
          ...overrides,
        },
      })
      return loadSnapshot(permitId, 'reply publication permit')
    }

    await withCapabilityOpen(pool, 'property.publish_reply', async () => {
      try {
        await insertAdminMember(pool, {
          userId: managerUser,
          memberId: managerMember,
          organizationId: ORGANIZATION_ID,
          name: 'Reply publication manager',
        })
        await insertActiveGoogleProperty(pool, {
          id: property,
          organizationId: ORGANIZATION_ID,
          connectionId: CONNECTION_ID,
          name: 'Reply publication property',
          confirmedBy: managerUser,
        })
        await insertOperatorPropertyGrant(pool, {
          organizationId: ORGANIZATION_ID,
          propertyId: property,
          userId: managerUser,
          createdBy: USER_ID,
        })
        await pool.query(
          `INSERT INTO reviews (
            id, organization_id, property_id, platform, external_id,
            external_location_id, google_connection_id, source_epoch,
            source_revision, analysis_sequence, source_content_state
          ) VALUES (
            $1, $2, $3, 'google', $5,
            $6, $4, 7, 9, 0, 'active'
          )`,
          [
            reviewId,
            ORGANIZATION_ID,
            property,
            CONNECTION_ID,
            GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
            GOOGLE_LOCATION_PRIMARY_RESOURCE,
          ],
        )
        await pool.query(
          `INSERT INTO material_review_revisions (
            review_id, revision, organization_id, property_id, source_epoch,
            normalization_version, source_digest, normalized_digest, rating,
            normalized_text, content_state
          ) VALUES (
            $1, 9, $2, $3, 7, 'review-material-v1', $4, $5, 5,
            'A helpful review', 'active'
          )`,
          [reviewId, ORGANIZATION_ID, property, '1'.repeat(64), '2'.repeat(64)],
        )
        await pool.query(
          `INSERT INTO replies (
            id, review_id, organization_id, text, status, source, created_by,
            approved_by, ai_generated, authorship, state_revision, approved_at,
            publication_state, publication_cycle, publication_attempts
          ) VALUES (
            $1, $2, $3, 'Thank you for your review.', 'approved', 'internal', $4,
            $4, false, 'human', 1, now(), 'sending', 3, 2
          )`,
          [replyId, reviewId, ORGANIZATION_ID, managerUser],
        )
        await pool.query(
          `INSERT INTO reply_publication_authorizations (
            organization_id, property_id, review_id, reply_id,
            publication_cycle, source_epoch, material_review_revision,
            base_observation_revision, authorized_by_user_id,
            reply_state_revision, normalization_version, expected_reply_digest,
            authorized_at
          ) VALUES (
            $1, $2, $3, $4, 3, 7, 9, 4, $5, 1,
            'google-reply-v1', $6, now()
          )`,
          [
            ORGANIZATION_ID,
            property,
            reviewId,
            replyId,
            managerUser,
            authorizationDigest,
          ],
        )
        await pool.query(
          `INSERT INTO reply_publication_attempts (
            organization_id, property_id, review_id, reply_id,
            publication_cycle, attempt_number, provider_operation_key,
            source_epoch, material_review_revision, reply_state_revision,
            base_observation_revision, normalization_version,
            expected_reply_digest, outcome
          ) VALUES (
            $1, $2, $3, $4, 3, 2, $5, 7, 9, 1, 4,
            'google-reply-v1', $6, 'sending'
          )`,
          [
            ORGANIZATION_ID,
            property,
            reviewId,
            replyId,
            `publication:${replyId}:3:2`,
            authorizationDigest,
          ],
        )

        const connectorMembership = await pool.query(
          `SELECT member.id
             FROM google_connections AS connection
             JOIN member
               ON member."organizationId" = connection.organization_id
              AND member."userId" = connection.connected_by
            WHERE connection.id = $1`,
          [CONNECTION_ID],
        )
        expect(connectorMembership.rowCount).toBe(0)
        await expect(authority().start(await seedPublicationPermit())).resolves.toBe(
          'started',
        )

        for (const [label, overrides] of [
          ['stale cycle', { publicationCycle: 4 }],
          ['stale material revision', { materialReviewRevision: 10 }],
          ['stale digest', { expectedReplyDigest: 'd'.repeat(64) }],
          ['non-current attempt', { publicationAttemptNumber: 3 }],
          ['wrong credential generation', { credentialGeneration: 2 }],
        ] as const) {
          const snapshot = await seedPublicationPermit(overrides)
          await expect(authority().start(snapshot), label).resolves.toBe('changed')
        }

        const revokedSnapshot = await seedPublicationPermit()
        await pool.query(
          `UPDATE property_access_grant
              SET revoked_at = now(), revoke_reason = 'authority-revoked-before-send'
            WHERE organization_id = $1 AND property_id = $2 AND user_id = $3
              AND revoked_at IS NULL`,
          [ORGANIZATION_ID, property, managerUser],
        )
        await expect(authority().start(revokedSnapshot)).resolves.toBe('changed')
      } finally {
        if (permitIds.length > 0) {
          await pool.query(
            `DELETE FROM authorization_execution_permits WHERE id = ANY($1::uuid[])`,
            [permitIds],
          )
        }
        await pool.query(
          'DELETE FROM reply_publication_attempts WHERE organization_id = $1',
          [ORGANIZATION_ID],
        )
        await pool.query(
          'DELETE FROM reply_publication_authorizations WHERE organization_id = $1',
          [ORGANIZATION_ID],
        )
        await pool.query('DELETE FROM replies WHERE organization_id = $1', [
          ORGANIZATION_ID,
        ])
        await pool.query('DELETE FROM reviews WHERE organization_id = $1', [
          ORGANIZATION_ID,
        ])
        await pool.query('DELETE FROM properties WHERE id = $1', [property])
        await pool.query('DELETE FROM member WHERE id = $1', [managerMember])
        await pool.query('DELETE FROM "user" WHERE id = $1', [managerUser])
      }
    })
  })

  it('starts PropertyManager Performance only while its Property grant is active', async () => {
    const { pool } = harness
    const property = randomUUID()
    const managerUser = `manager-${randomUUID()}`
    const managerMember = `member-${randomUUID()}`
    const allowedPermitId = randomUUID()
    const deniedPermitId = randomUUID()
    const seedPerformancePermit = async (permitId: string) =>
      insertAdmittedPermit(pool, {
        id: permitId,
        capability: 'property.read_gbp_performance',
        organizationId: ORGANIZATION_ID,
        propertyId: property,
        connectionId: CONNECTION_ID,
        initiatorUserId: managerUser,
        operationKey: 'provider.performance.fetch',
        compiled: compiledPerformance,
        vector: {
          executionPolicyVersion: 'beta-local-2',
          principalKind: 'user',
          role: 'PropertyManager',
          permissionVersion: await currentPermissionVersion(pool, ORGANIZATION_ID),
          permissionDigest: 'e'.repeat(64),
          connectionLifecycleVersion: 1,
          connectionAccessVersion: 1,
          credentialGeneration: 1,
          ...ACTIVE_PROPERTY_VECTOR,
          ...admissionBindings(compiledPerformance),
        },
      })

    await withCapabilityOpen(pool, 'property.read_gbp_performance', async () => {
      try {
        await insertAdminMember(pool, {
          userId: managerUser,
          memberId: managerMember,
          organizationId: ORGANIZATION_ID,
          name: 'Performance Manager',
        })
        await insertActiveGoogleProperty(pool, {
          id: property,
          organizationId: ORGANIZATION_ID,
          connectionId: CONNECTION_ID,
          name: 'Performance property',
          confirmedBy: managerUser,
        })
        const grantId = await insertOperatorPropertyGrant(pool, {
          organizationId: ORGANIZATION_ID,
          propertyId: property,
          userId: managerUser,
          createdBy: 'test',
        })

        await seedPerformancePermit(allowedPermitId)
        const allowed = await loadSnapshot(allowedPermitId, 'Performance permit')
        await expect(authority().start(allowed)).resolves.toBe('started')

        await pool.query(
          `UPDATE property_access_grant SET revoked_at = now(), revoke_reason = 'test'
            WHERE id = $1`,
          [grantId],
        )
        await seedPerformancePermit(deniedPermitId)
        const denied = await loadSnapshot(deniedPermitId, 'denied Performance permit')
        await expect(authority().start(denied)).resolves.toBe('changed')
      } finally {
        await pool.query(
          `DELETE FROM authorization_execution_permits WHERE id IN ($1, $2)`,
          [allowedPermitId, deniedPermitId],
        )
        await pool.query('DELETE FROM properties WHERE id = $1', [property])
        await pool.query('DELETE FROM member WHERE id = $1', [managerMember])
        await pool.query('DELETE FROM "user" WHERE id = $1', [managerUser])
      }
    })
  })
})
