import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { nextMerchantAiCapabilityEpochs } from '../domain/merchant-ai-capability-epochs'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { holdTransaction } from '#/shared/db/testing/held-transaction'
import {
  isMerchantAiNoticeInForce,
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1,
  MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1,
} from '#/shared/ai-review-source/ai-review-source-contract'
import { createMerchantAiAuthorizationStore } from './merchant-ai-authorization.repository.server'
import { CURRENT_MERCHANT_AI_CAPABILITIES } from './merchant-ai-authorization.server'
import { getAiRuntimeCapability } from '#/shared/merchant-ai-notice/ai-runtime-capability-contract'
import {
  advanceAnalysisHead,
  applyTransition,
  change,
  command,
  db,
  enableAsBeforeTheSwitchOn,
  fence,
  isConsentActive,
  NOTICE_2026_10_17,
  NOTICE_2026_10_30,
  NOTICE_2026_11_01,
  ORG,
  PREVIOUS_NOTICE_DIGEST,
  PREVIOUS_NOTICE_VERSION,
  PROPERTY,
  PURPOSE_BY_CAPABILITY,
  setAnalysisHead,
  statementsOf,
  store,
  underServedContract,
  useMerchantAiFixture,
  NOW,
} from './merchant-ai.test-fixtures'

useMerchantAiFixture()

/** The migrations that state the notice catalogue function, oldest first. */
const FORWARD_MIGRATIONS = [
  new URL(
    '../../../../drizzle/0084_merchant_ai_consent_follows_notice.sql',
    import.meta.url,
  ),
  new URL('../../../../drizzle/0088_reply_drafting_v2_release.sql', import.meta.url),
  new URL(
    '../../../../drizzle/0100_merchant_ai_notice_retention_corrections.sql',
    import.meta.url,
  ),
  new URL(
    '../../../../drizzle/0101_validate_merchant_ai_notice_retention_corrections.sql',
    import.meta.url,
  ),
] as const

describe('Merchant AI authorization store', () => {
  it('accumulates notice changes once, refuses retired trends, and reads streaming deployment evidence', async () => {
    const before = await store.mutate(command({ ...NOTICE_2026_10_30 }))
    for (const capability of CURRENT_MERCHANT_AI_CAPABILITIES) {
      expect(underServedContract(before, capability)).toBe(false)
      expect(
        await isConsentActive(
          PURPOSE_BY_CAPABILITY[capability],
          fence(before, capability),
        ),
      ).toBe(false)
    }
    const analysisHead = await advanceAnalysisHead()
    const after = await store.mutate(change(before, 'notice-renewal'))
    for (const capability of CURRENT_MERCHANT_AI_CAPABILITIES) {
      expect(underServedContract(after, capability)).toBe(
        capability !== 'property_trends',
      )
      expect(
        await isConsentActive(
          PURPOSE_BY_CAPABILITY[capability],
          fence(after, capability),
        ),
      ).toBe(capability !== 'property_trends')
    }
    expect(after.capabilityEpochs).toEqual({
      review_analysis: before.capabilityEpochs.review_analysis + 1,
      reply_drafting: before.capabilityEpochs.reply_drafting + 1,
      property_trends: before.capabilityEpochs.property_trends + 1,
    })
    expect(after.analysisStartSequence).toBe(analysisHead)
    const again = await store.mutate(change(before, 'notice-renewal'))
    expect(again).toEqual(after)
    // CHECK expansion and mapSnapshot admit the streaming deployment; the evidence
    // remains historical and is not rewritten by the actual switch-on migration.
    // No transition writes this value (a technical refresh writes nothing), and the
    // head guard refuses a row edit outside one, so the guard is set aside for the
    // one synthetic edit inside a held transaction that is always rolled back.
    const held = await holdTransaction()
    try {
      await held.client.query(
        'ALTER TABLE merchant_ai_enablement DISABLE TRIGGER merchant_ai_enablement_transition_guard',
      )
      await held.client.query(
        `UPDATE merchant_ai_enablement SET provider_deployment_profile_version = 'private-beta-global-v3' WHERE organization_id = $1`,
        [ORG],
      )
      await held.client.query(
        'ALTER TABLE merchant_ai_enablement ENABLE TRIGGER merchant_ai_enablement_transition_guard',
      )
      await expect(
        createMerchantAiAuthorizationStore(
          held.db,
          randomUUID,
          replyScopeEffects,
        ).getSnapshot({
          organizationId: ORG,
          propertyId: PROPERTY,
        }),
      ).resolves.toMatchObject({
        providerDeploymentProfileVersion: 'private-beta-global-v3',
      })
    } finally {
      await held.rollBack()
    }
    // The rolled-back edit left the committed head as the transition wrote it.
    await expect(
      store.getSnapshot({ organizationId: ORG, propertyId: PROPERTY }),
    ).resolves.toMatchObject({
      providerDeploymentProfileVersion: 'private-beta-global-v2',
    })
  })

  it('accepts the current notice in both contract CHECKs and refuses an unknown or mixed pair', async () => {
    const enabled = await store.mutate(command())
    const recorded = await db.execute(sql`
      SELECT
        (SELECT notice_version FROM merchant_ai_enablement WHERE organization_id = ${ORG}) AS head_version,
        (SELECT notice_digest FROM merchant_ai_enablement WHERE organization_id = ${ORG}) AS head_digest,
        (SELECT notice_version FROM merchant_ai_consent_evidence WHERE organization_id = ${ORG}) AS evidence_version
    `)
    expect(recorded.rows[0]).toEqual({
      head_version: MERCHANT_AI_NOTICE_VERSION,
      head_digest: MERCHANT_AI_NOTICE_DIGEST,
      evidence_version: MERCHANT_AI_NOTICE_VERSION,
    })

    const refusedPairs = [
      { version: 'merchant-ai-notice-2099-01-01.v1', digest: MERCHANT_AI_NOTICE_DIGEST },
      // A known version never borrows another version's digest.
      { version: MERCHANT_AI_NOTICE_VERSION, digest: PREVIOUS_NOTICE_DIGEST },
    ]
    for (const [index, pair] of refusedPairs.entries()) {
      await expect(
        applyTransition(db, {
          lineageId: enabled.authorizationLineageId,
          fromVersion: enabled.stateVersion,
          runtimeProfiles: enabled.capabilityRuntimeProfileVersions,
          epochs: {
            review_analysis: enabled.capabilityEpochs.review_analysis + 1,
            reply_drafting: enabled.capabilityEpochs.reply_drafting + 1,
            property_trends: enabled.capabilityEpochs.property_trends + 1,
          },
          analysisStartSequence: enabled.analysisStartSequence,
          notice: { noticeVersion: pair.version, noticeDigest: pair.digest },
          reasonCode: 'capabilities_changed',
          idempotencyKey: `unknown-notice-${index}`,
          digestFill: 'd',
        }),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          code: '23514',
          constraint: 'merchant_ai_consent_evidence_contract_valid',
        }),
      })
    }

    // The head carries its own CHECK. Its transition guard would refuse the
    // write first, so the guard is set aside inside a transaction that the
    // refusal rolls back, trigger state included.
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`
          ALTER TABLE merchant_ai_enablement
          DISABLE TRIGGER merchant_ai_enablement_transition_guard
        `)
        await tx.execute(sql`
          UPDATE merchant_ai_enablement
          SET notice_version = 'merchant-ai-notice-2099-01-01.v1'
          WHERE organization_id = ${ORG}
        `)
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: '23514',
        constraint: 'merchant_ai_enablement_contract_valid',
      }),
    })
    const guard = await db.execute(sql`
      SELECT tgenabled
      FROM pg_trigger
      WHERE tgname = 'merchant_ai_enablement_transition_guard'
    `)
    expect(guard.rows).toEqual([{ tgenabled: 'O' }])
  })

  // The switch-on of review analysis v3 (2026-10-30). A deploy rewrites no head: a
  // Property enabled the day before holds the 2026-10-17 notice, the deployment profile
  // `private-beta-global-v1` and the review analysis runtime profile v1. The head stays a
  // valid row in both CHECKs, and the application serves none of it: the notice is not in
  // force, so every capability's consent lapses and AI work is refused before it is claimed.
  //
  // The next consent an AccountAdmin gives is the served contract's, and it is a contract
  // change as `apply_merchant_ai_transition_v1` counts it: the notice, the deployment
  // profile and the review analysis runtime profile all differ, so every capability the
  // Property had or keeps advances its epoch ONCE (the review analysis epoch included:
  // that is what makes the enrollment replay analyse the history again under v3), and the
  // review analysis watermark resets to the Review head, so a review that arrived under
  // the old consent is analysed too. Pinned here so that one-time replay is a tested
  // contract and not a side effect (docs/BETA.md §2, 2026-10-30).
  it('lapses a grant recorded before the switch-on; its next consent records the served contract, advances every epoch once and resets the watermark', async () => {
    const before = await enableAsBeforeTheSwitchOn()
    expect(before).toMatchObject({
      state: 'enabled',
      ...NOTICE_2026_10_17,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      capabilityRuntimeProfileVersions: {
        review_analysis: 'review-analysis-runtime-v1',
      },
    })
    expect(isMerchantAiNoticeInForce(before, 'reply_drafting')).toBe(false)
    for (const capability of CURRENT_MERCHANT_AI_CAPABILITIES) {
      expect(underServedContract(before, capability)).toBe(false)
    }

    // A review arrives under the old consent, after its watermark.
    const arrivedUnderOldConsent = await advanceAnalysisHead()
    expect(arrivedUnderOldConsent).toBeGreaterThan(before.analysisStartSequence)
    const reconsented = await store.mutate(
      change(before, 'served-contract-reconsent', {
        capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
      }),
    )
    expect(reconsented).toMatchObject({
      authorizationLineageId: before.authorizationLineageId,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      providerDeploymentProfileVersion: 'private-beta-global-v2',
      capabilityRuntimeProfileVersions: {
        review_analysis: 'review-analysis-runtime-v2',
      },
      capabilityEpochs: {
        review_analysis: before.capabilityEpochs.review_analysis + 1,
        reply_drafting: before.capabilityEpochs.reply_drafting + 1,
        property_trends: before.capabilityEpochs.property_trends + 1,
      },
    })
    expect(isMerchantAiNoticeInForce(reconsented, 'reply_drafting')).toBe(true)
    for (const capability of CURRENT_MERCHANT_AI_CAPABILITIES) {
      expect(underServedContract(reconsented, capability)).toBe(
        capability !== 'property_trends',
      )
    }
    // The watermark moved to the head: the replay covers that review too.
    expect(reconsented.analysisStartSequence).toBe(arrivedUnderOldConsent)

    // Under the served contract the same kind of change moves only the capability it
    // adds, and the analysis watermark stays where the replay started.
    await advanceAnalysisHead()
    const reduced = await store.mutate(
      change(reconsented, 'served-contract-reduce', {
        capabilities: ['review_analysis', 'reply_drafting'],
      }),
    )
    const readded = await store.mutate(
      change(reduced, 'served-contract-readd', {
        capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
      }),
    )
    expect(readded).toMatchObject({
      capabilityEpochs: {
        ...reduced.capabilityEpochs,
        property_trends: reduced.capabilityEpochs.property_trends + 1,
      },
      analysisStartSequence: reconsented.analysisStartSequence,
    })
    const evidence = await db.execute(sql`
      SELECT notice_version, notice_digest, provider_deployment_profile_version
      FROM merchant_ai_consent_evidence
      WHERE organization_id = ${ORG}
      ORDER BY state_version
    `)
    const served = {
      notice_version: MERCHANT_AI_NOTICE_VERSION,
      notice_digest: MERCHANT_AI_NOTICE_DIGEST,
      provider_deployment_profile_version: 'private-beta-global-v2',
    }
    expect(evidence.rows).toEqual([
      {
        notice_version: NOTICE_2026_10_17.noticeVersion,
        notice_digest: NOTICE_2026_10_17.noticeDigest,
        provider_deployment_profile_version: 'private-beta-global-v1',
      },
      served,
      served,
      served,
    ])
  })

  it('keeps pre-existing historical evidence readable across the forward migrations', async () => {
    const before = await enableAsBeforeTheSwitchOn()
    // Later migrations restate merchant_ai_notice_material_changes_v1, and the newest
    // wins, so they are replayed in journal order inside a held transaction that is
    // always rolled back. A committed replay of 0084 alone would put the superseded
    // catalogue back for every test and every suite that runs after this one.
    const held = await holdTransaction()
    try {
      for (const migration of FORWARD_MIGRATIONS) {
        for (const statement of statementsOf(migration)) {
          await held.client.query(statement)
        }
      }
      expect(
        await createMerchantAiAuthorizationStore(
          held.db,
          randomUUID,
          replyScopeEffects,
        ).getSnapshot({
          organizationId: ORG,
          propertyId: PROPERTY,
        }),
      ).toEqual(before)
      const evidence = await held.client.query(
        `SELECT notice_version, notice_digest, capability_runtime_profile_versions FROM merchant_ai_consent_evidence WHERE organization_id = $1 AND property_id = $2::uuid`,
        [ORG, PROPERTY],
      )
      expect(evidence.rows).toEqual([
        {
          notice_version: before.noticeVersion,
          notice_digest: before.noticeDigest,
          capability_runtime_profile_versions: before.capabilityRuntimeProfileVersions,
        },
      ])
    } finally {
      await held.rollBack()
    }
  })

  it('allows served work with historical runtime/deployment evidence, without a consent write or epoch bump', async () => {
    const initial = await enableAsBeforeTheSwitchOn({
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    })
    for (const purpose of ['ai.analyze', 'ai.generate_reply', 'ai.detect_trends']) {
      await expect(isConsentActive(purpose)).resolves.toBe(purpose !== 'ai.detect_trends')
    }
    await expect(
      isConsentActive('ai.analyze', fence(initial, 'review_analysis')),
    ).resolves.toBe(true)
    await expect(
      isConsentActive('ai.analyze', {
        ...fence(initial, 'review_analysis'),
        servedExecution: {
          ...getAiRuntimeCapability('review_analysis'),
          operationProfileVersion: 'unknown',
        },
      }),
    ).resolves.toBe(false)
    await expect(
      store.mutate(
        command({
          operation: 'change',
          expectedStateVersion: 1,
          idempotencyKey: 'technical-refresh',
        }),
      ),
    ).rejects.toMatchObject({ code: 'no_op' })
    expect(
      await store.getSnapshot({ organizationId: ORG, propertyId: PROPERTY }),
    ).toEqual(initial)
    const evidence = await db.execute(
      sql`SELECT count(*)::integer AS count FROM merchant_ai_consent_evidence WHERE organization_id = ${ORG} AND property_id = ${PROPERTY}::uuid`,
    )
    expect(evidence.rows[0]?.count).toBe(1)
  })

  it('matches TypeScript epochs and preserves the analysis frontier for a drafting-only material notice', async () => {
    const initial = await enableAsBeforeTheSwitchOn(NOTICE_2026_10_30)
    const expected = nextMerchantAiCapabilityEpochs(
      initial,
      { ...initial, operation: 'change', capabilities: CURRENT_MERCHANT_AI_CAPABILITIES },
      false,
      ['reply_drafting'],
    )
    await db.transaction(async (tx) => {
      await setAnalysisHead(38, tx)
      const result = await applyTransition(tx, {
        lineageId: initial.authorizationLineageId,
        fromVersion: 1,
        runtimeProfiles: {
          review_analysis: 'review-analysis-runtime-v2',
          reply_drafting: 'reply-drafting-runtime-v1',
          property_trends: 'property-trends-runtime-v1',
        },
        epochs: expected,
        analysisStartSequence: initial.analysisStartSequence,
        notice: NOTICE_2026_11_01,
        reasonCode: 'notice_reconsented',
        idempotencyKey: 'drafting-material-only',
        digestFill: 'c',
        expand: true,
      })
      expect(result.rows[0]).toMatchObject({
        review_analysis_epoch: 1,
        reply_drafting_epoch: 2,
        property_trends_epoch: 1,
        analysis_start_sequence: String(initial.analysisStartSequence),
      })
    })
  })

  it.each([
    [
      'source_policy_id',
      { sourcePolicyId: 'previous-source-policy' },
      'previous-source-policy',
    ],
    ['routing_policy_version', { routingPolicyVersion: 2 }, 2],
    [
      'redaction_profile_family',
      { redactionProfileFamily: 'previous-redaction' },
      'previous-redaction',
    ],
  ] as const)(
    'matches TypeScript epoch invalidation when %s changes',
    async (column, previousPolicy, value) => {
      const initial = await store.mutate(command())
      const desired = command({ operation: 'change', expectedStateVersion: 1 })
      const expected = nextMerchantAiCapabilityEpochs(
        { ...initial, ...previousPolicy },
        desired,
        false,
        [],
      )
      expect(expected).toEqual({
        review_analysis: 2,
        reply_drafting: 2,
        property_trends: 2,
      })
      const rollback = new Error('rollback synthetic prior data-use policy')
      await expect(
        db.transaction(async (tx) => {
          // Simulate an older policy without expanding the production CHECK catalogue.
          // The whole fixture, including this DDL, is rolled back at the end.
          await tx.execute(
            sql`ALTER TABLE merchant_ai_enablement DROP CONSTRAINT merchant_ai_enablement_contract_valid`,
          )
          await tx.execute(
            sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`,
          )
          // The head guard refuses a policy edit outside a transition; switch it off for
          // this one synthetic row edit only, then back on before the real transition.
          await tx.execute(
            sql`ALTER TABLE merchant_ai_enablement DISABLE TRIGGER merchant_ai_enablement_transition_guard`,
          )
          await tx.execute(sql`UPDATE merchant_ai_enablement SET ${sql.identifier(column)} = ${value}
        WHERE organization_id = ${ORG} AND property_id = ${PROPERTY}::uuid`)
          await tx.execute(
            sql`ALTER TABLE merchant_ai_enablement ENABLE TRIGGER merchant_ai_enablement_transition_guard`,
          )
          const result = await applyTransition(tx, {
            lineageId: initial.authorizationLineageId,
            fromVersion: 1,
            runtimeProfiles: initial.capabilityRuntimeProfileVersions,
            epochs: expected,
            analysisStartSequence: initial.analysisStartSequence,
            reasonCode: 'notice_reconsented',
            idempotencyKey: 'data-use-policy-change',
            digestFill: 'c',
            expand: true,
          })
          expect(result.rows[0]).toMatchObject({
            review_analysis_epoch: expected.review_analysis,
            reply_drafting_epoch: expected.reply_drafting,
            property_trends_epoch: expected.property_trends,
          })
          throw rollback
        }),
      ).rejects.toBe(rollback)
    },
  )

  it('resnapshots the full eligible Review population when notice re-consent advances the analysis epoch', async () => {
    const enabled = await store.mutate(
      command({
        noticeVersion: PREVIOUS_NOTICE_VERSION,
        noticeDigest: PREVIOUS_NOTICE_DIGEST,
      }),
    )
    await db.execute(sql`
      INSERT INTO reviews (
        id, organization_id, property_id, platform, source_epoch,
        source_revision, analysis_sequence
      ) VALUES
        ('10000000-0000-4000-8000-000000000020'::uuid, ${ORG}, ${PROPERTY}::uuid,
          'google', 3, 1, 20),
        ('10000000-0000-4000-8000-000000000038'::uuid, ${ORG}, ${PROPERTY}::uuid,
          'google', 3, 1, 38)
    `)
    await db.execute(sql`
      INSERT INTO review_source_contents (
        review_id, organization_id, property_id, platform, external_id,
        external_location_id, reviewer_name, rating, text, language_code,
        reviewed_at, last_fetched_at, content_expires_at, source_epoch,
        source_revision, ai_source_byte_length, ai_source_digest
      ) VALUES
        (
          '10000000-0000-4000-8000-000000000020'::uuid, ${ORG}, ${PROPERTY}::uuid,
          'google', 'notice-reconsent-review-20', 'locations/notice-reconsent',
          'Synthetic reviewer', 5, 'Eligible review twenty', 'en', ${NOW}, ${NOW},
          '2099-09-10T00:00:00.000Z', 3, 1, 22, ${'a'.repeat(64)}
        ),
        (
          '10000000-0000-4000-8000-000000000038'::uuid, ${ORG}, ${PROPERTY}::uuid,
          'google', 'notice-reconsent-review-38', 'locations/notice-reconsent',
          'Synthetic reviewer', 4, 'Eligible review thirty eight', 'en', ${NOW}, ${NOW},
          '2099-09-10T00:00:00.000Z', 3, 1, 28, ${'b'.repeat(64)}
        )
    `)
    await setAnalysisHead(38)

    const reconsented = await store.mutate(
      change(enabled, 'notice-reconsent', { reasonCode: 'notice_reconsented' }),
    )
    const eligible = await db.execute(sql`
      SELECT r.id
      FROM reviews AS r
      INNER JOIN review_source_contents AS c ON c.review_id = r.id
      WHERE r.organization_id = ${ORG}
        AND r.property_id = ${PROPERTY}::uuid
        AND r.source_epoch = 3
        AND r.source_revision >= 1
        AND r.analysis_sequence <= ${reconsented.analysisStartSequence}
        AND c.text IS NOT NULL
        AND c.content_expires_at > transaction_timestamp()
        AND c.ai_source_byte_length <= ${MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1}
        AND (
          COALESCE(octet_length(c.text), 0)::bigint
          + COALESCE(octet_length(c.language_code), 0)::bigint
          + COALESCE(octet_length(c.reviewer_name), 0)::bigint
        ) <= ${MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1}
      ORDER BY r.analysis_sequence
    `)

    expect(reconsented).toMatchObject({
      capabilityEpochs: { review_analysis: 2 },
      analysisStartSequence: 38,
    })
    expect(eligible.rows).toEqual([
      { id: '10000000-0000-4000-8000-000000000020' },
      { id: '10000000-0000-4000-8000-000000000038' },
    ])
  })

  it('rejects watermark advancement when the Review Analysis epoch does not advance', async () => {
    const enabled = await store.mutate(command())
    await setAnalysisHead(38)

    await expect(
      applyTransition(db, {
        lineageId: enabled.authorizationLineageId,
        fromVersion: enabled.stateVersion,
        capabilities: ['review_analysis', 'property_trends'],
        runtimeProfiles: {
          review_analysis: 'review-analysis-runtime-v2',
          property_trends: 'property-trends-runtime-v1',
        },
        epochs: {
          review_analysis: enabled.capabilityEpochs.review_analysis,
          reply_drafting: enabled.capabilityEpochs.reply_drafting + 1,
          property_trends: enabled.capabilityEpochs.property_trends,
        },
        analysisStartSequence: 38,
        reasonCode: 'capabilities_changed',
        idempotencyKey: 'invalid-watermark-advance',
        digestFill: 'c',
        ceremonyId: null,
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: 'merchant_ai_invalid_analysis_sequence',
      }),
    })

    const changed = await store.mutate(
      change(enabled, 'valid-unchanged-watermark', {
        capabilities: ['review_analysis', 'property_trends'],
      }),
    )
    expect(changed).toMatchObject({
      analysisStartSequence: 7,
      capabilityEpochs: { review_analysis: 1 },
    })
  })
})
