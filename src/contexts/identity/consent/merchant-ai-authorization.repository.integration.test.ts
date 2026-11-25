import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  MerchantAiAuthorizationStoreError,
} from './merchant-ai-authorization.server'
import {
  advanceAnalysisHead,
  change,
  command,
  db,
  deleteAnalysisHead,
  fence,
  isConsentActive,
  NOW,
  ORG,
  PROPERTY,
  readAnalysisHead,
  replaceSourceEpoch,
  setAnalysisHead,
  store,
  useMerchantAiFixture,
  USER,
} from './merchant-ai.test-fixtures'

const fixture = useMerchantAiFixture()

describe('Merchant AI authorization store', () => {
  it('returns null before a merchant makes a choice', async () => {
    await expect(
      store.getSnapshot({ organizationId: ORG, propertyId: PROPERTY }),
    ).resolves.toBeNull()
  })

  it('atomically commits the current head, immutable evidence, exact fence, and identifier-only event', async () => {
    const snapshot = await store.mutate(command())

    expect(snapshot).toMatchObject({
      state: 'enabled',
      stateVersion: 1,
      authorizedSourceEpoch: 3,
      analysisStartSequence: 7,
      capabilityEpochs: {
        review_analysis: 1,
        reply_drafting: 1,
        property_trends: 1,
      },
      capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      providerDeploymentProfileVersion: 'private-beta-global-v2',
    })
    expect(snapshot.authorizationLineageId).toMatch(/^[0-9a-f-]{36}$/)

    await expect(
      isConsentActive('ai.analyze', fence(snapshot, 'review_analysis')),
    ).resolves.toBe(true)
    await expect(
      isConsentActive('ai.analyze', {
        ...fence(snapshot, 'review_analysis'),
        capabilityEpoch: 2,
      }),
    ).resolves.toBe(false)

    const evidence = await db.execute(sql`
      SELECT transition_kind, state, review_analysis_epoch, reply_drafting_epoch,
             property_trends_epoch, authorized_source_epoch,
             analysis_start_sequence, state_version, idempotency_key, notice_digest
      FROM merchant_ai_consent_evidence
      WHERE organization_id = ${ORG}
    `)
    expect(evidence.rows).toEqual([
      expect.objectContaining({
        transition_kind: 'enable',
        state: 'enabled',
        review_analysis_epoch: 1,
        reply_drafting_epoch: 1,
        property_trends_epoch: 1,
        authorized_source_epoch: 3,
        analysis_start_sequence: '7',
        state_version: 1,
        idempotency_key: 'merchant-command-0001',
        notice_digest: MERCHANT_AI_NOTICE_DIGEST,
      }),
    ])
    const outbox = await db.execute(sql`
      SELECT event_type, payload
      FROM outbox_events
      WHERE organization_id = ${ORG}
    `)
    expect(outbox.rows).toEqual([
      expect.objectContaining({
        event_type: 'identity.merchant_ai.changed',
        payload: expect.objectContaining({
          organizationId: ORG,
          propertyId: PROPERTY,
          authorizationLineageId: snapshot.authorizationLineageId,
          reviewAnalysisEpoch: snapshot.capabilityEpochs.review_analysis,
          replyDraftingEpoch: snapshot.capabilityEpochs.reply_drafting,
          propertyTrendsEpoch: snapshot.capabilityEpochs.property_trends,
          authorizedSourceEpoch: 3,
          analysisStartSequence: 7,
          stateVersion: 1,
          state: 'enabled',
        }),
      }),
    ])
    expect(outbox.rows[0]?.payload).not.toHaveProperty('actorUserId')
    expect(outbox.rows[0]?.payload).not.toHaveProperty('capabilities')
  })

  it('creates an explicit zero Review head when enabling analysis on a zero-review Property', async () => {
    await deleteAnalysisHead()

    const snapshot = await store.mutate(command())

    expect(snapshot).toMatchObject({
      state: 'enabled',
      authorizedSourceEpoch: 3,
      analysisStartSequence: 0,
    })
    expect(await readAnalysisHead()).toEqual([{ head_sequence: '0' }])
  })

  it('does not manufacture a zero frontier when a material Review exists', async () => {
    await deleteAnalysisHead()
    await db.execute(sql`
      INSERT INTO reviews (
        id, organization_id, property_id, platform, source_epoch,
        source_revision, analysis_sequence
      ) VALUES (
        '10000000-0000-4000-8000-000000000099'::uuid,
        ${ORG}, ${PROPERTY}::uuid, 'google', 3, 1, 1
      )
    `)

    await expect(store.mutate(command())).rejects.toMatchObject({
      code: 'property_inactive',
      message: 'Current Review analysis source head is unavailable',
    })
    expect(await readAnalysisHead()).toEqual([])
  })

  it('serializes zero-review authorization with the first material-revision allocation', async () => {
    await deleteAnalysisHead()

    const [enabled, firstSequence] = await Promise.all([
      store.mutate(command()),
      advanceAnalysisHead(),
    ])

    expect(firstSequence).toBe(1)
    expect([0, 1]).toContain(enabled.analysisStartSequence)
    if (enabled.analysisStartSequence === 0) {
      // Authorization won the shared Property lock. The first revision is a
      // live arrival strictly after the captured zero frontier.
      expect(firstSequence).toBe(enabled.analysisStartSequence + 1)
    } else {
      // Review allocation won. The first revision is inside enrollment's
      // immutable first-enablement frontier.
      expect(firstSequence).toBe(enabled.analysisStartSequence)
    }
  })

  it('fails exact consent fences after source, state, notice, or runtime drift', async () => {
    const snapshot = await store.mutate(command())
    const expectedFence = fence(snapshot, 'review_analysis')
    await replaceSourceEpoch(4)

    await expect(isConsentActive('ai.analyze', expectedFence)).resolves.toBe(false)
    for (const changedFence of [
      { ...expectedFence, stateVersion: expectedFence.stateVersion + 1 },
      { ...expectedFence, noticeDigest: '0'.repeat(64) },
      { ...expectedFence, recordedRuntimeProfileVersion: 'wrong-runtime' },
      {
        ...expectedFence,
        servedExecution: {
          ...expectedFence.servedExecution,
          runtimeProfileVersion: 'wrong-runtime',
        },
      },
      {
        ...expectedFence,
        authorizationLineageId: '30000000-0000-4000-8000-000000000001',
      },
    ]) {
      await expect(isConsentActive('ai.analyze', changedFence)).resolves.toBe(false)
    }
  })

  it('replays the exact committed result and rejects a changed idempotent command', async () => {
    const first = await store.mutate(command())
    await expect(store.mutate(command())).resolves.toEqual(first)
    await expect(
      store.mutate(command({ capabilities: ['review_analysis'] })),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' })

    const counts = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM merchant_ai_consent_evidence WHERE organization_id = ${ORG}) AS evidence,
        (SELECT count(*)::int FROM outbox_events WHERE organization_id = ${ORG}) AS events
    `)
    expect(counts.rows[0]).toEqual({ evidence: 1, events: 1 })
  })

  it('records each command under its own ceremony and keeps the first ceremony on replay', async () => {
    const enableCeremony = randomUUID()
    const changeCeremony = randomUUID()
    const enabled = await store.mutate(command({ ceremonyId: enableCeremony }))
    // A retried command mints a new ceremony id; replay identity ignores it.
    await expect(store.mutate(command({ ceremonyId: randomUUID() }))).resolves.toEqual(
      enabled,
    )
    await store.mutate(
      change(enabled, 'ceremony-change', {
        capabilities: ['review_analysis'],
        ceremonyId: changeCeremony,
      }),
    )

    const evidence = await db.execute(sql`
      SELECT idempotency_key, ceremony_id
      FROM merchant_ai_consent_evidence
      WHERE organization_id = ${ORG}
      ORDER BY state_version
    `)
    expect(evidence.rows).toEqual([
      { idempotency_key: 'merchant-command-0001', ceremony_id: enableCeremony },
      { idempotency_key: 'ceremony-change', ceremony_id: changeCeremony },
    ])
  })

  it('enforces transition, optimistic-version, and material-change rules', async () => {
    await expect(
      store.mutate(
        command({
          operation: 'change',
          idempotencyKey: 'change-before-enable',
          capabilities: ['review_analysis'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_transition' })

    await store.mutate(command())
    await expect(
      store.mutate(
        command({
          operation: 'change',
          idempotencyKey: 'stale-change',
          expectedStateVersion: 0,
          capabilities: ['review_analysis'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'version_conflict' })
    await expect(
      store.mutate(
        command({
          operation: 'change',
          idempotencyKey: 'no-op-change',
          expectedStateVersion: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'no_op' })
  })

  it('serializes a concurrent Review head advance at the consent watermark', async () => {
    const [enabled, advancedSequence] = await Promise.all([
      store.mutate(command()),
      advanceAnalysisHead(),
    ])

    expect(advancedSequence).toBe(8)
    expect([7, 8]).toContain(enabled.analysisStartSequence)
    if (enabled.analysisStartSequence === 7) {
      // The mutation serialized after consent and is the exact next sequence.
      expect(advancedSequence).toBe(enabled.analysisStartSequence + 1)
    } else {
      // The mutation serialized before consent and is included in the skipped watermark.
      expect(advancedSequence).toBe(enabled.analysisStartSequence)
    }

    const persisted = await store.getSnapshot({
      organizationId: ORG,
      propertyId: PROPERTY,
    })
    expect(persisted?.analysisStartSequence).toBe(enabled.analysisStartSequence)
    const outbox = await db.execute(sql`
      SELECT payload
      FROM outbox_events
      WHERE organization_id = ${ORG}
        AND event_type = 'identity.merchant_ai.changed'
    `)
    expect(outbox.rows[0]?.payload).toMatchObject({
      authorizedSourceEpoch: 3,
      analysisStartSequence: enabled.analysisStartSequence,
      reviewAnalysisEpoch: 1,
    })
  })

  it('resnapshots the current Review head when analysis is enabled again', async () => {
    const enabled = await store.mutate(command())
    const replyOnly = await store.mutate(
      change(1, 'reply-only', { capabilities: ['reply_drafting'] }),
    )
    expect(replyOnly.analysisStartSequence).toBe(7)
    await setAnalysisHead(13)

    const analysisEnabled = await store.mutate(
      change(2, 'analysis-enabled-again', {
        capabilities: ['review_analysis', 'reply_drafting'],
      }),
    )
    expect(analysisEnabled).toMatchObject({
      authorizationLineageId: enabled.authorizationLineageId,
      analysisStartSequence: 13,
      capabilityEpochs: {
        review_analysis: 3,
        reply_drafting: 1,
        property_trends: 2,
      },
    })
  })

  it('increments only toggled capability epochs and every enabled epoch on source rebind', async () => {
    const initial = await store.mutate(command())
    const reduced = await store.mutate(
      change(1, 'capability-reduced', { capabilities: ['review_analysis'] }),
    )
    expect(reduced.capabilityEpochs).toEqual({
      review_analysis: 1,
      reply_drafting: 2,
      property_trends: 2,
    })
    const oldFence = fence(reduced, 'review_analysis')

    await replaceSourceEpoch(4, 2)
    await expect(isConsentActive('ai.analyze', oldFence)).resolves.toBe(false)
    const rebound = await store.mutate(
      change(2, 'source-rebound', {
        capabilities: ['review_analysis'],
        reasonCode: 'source_rebound',
      }),
    )
    expect(rebound).toMatchObject({
      authorizationLineageId: initial.authorizationLineageId,
      authorizedSourceEpoch: 4,
      analysisStartSequence: 2,
      capabilityEpochs: {
        review_analysis: 2,
        reply_drafting: 2,
        property_trends: 2,
      },
    })
  })

  it('revokes after source disconnection without moving the watermark and denies every old fence', async () => {
    const enabled = await store.mutate(command())
    const oldFence = fence(enabled, 'review_analysis')
    await setAnalysisHead(38)
    await db.execute(sql`
      UPDATE properties
      SET lifecycle_state = 'suspended',
          google_binding_state = 'disconnected',
          source_epoch = source_epoch + 1
      WHERE id = ${PROPERTY}::uuid
    `)

    const revoked = await store.mutate(
      command({
        operation: 'revoke',
        idempotencyKey: 'merchant-revoked',
        expectedStateVersion: 1,
        state: 'revoked',
        capabilities: [],
        reasonCode: 'merchant_revoked',
      }),
    )
    expect(revoked).toMatchObject({
      state: 'revoked',
      authorizedSourceEpoch: 3,
      analysisStartSequence: 7,
      capabilityEpochs: {
        review_analysis: 2,
        reply_drafting: 2,
        property_trends: 2,
      },
    })
    await expect(isConsentActive('ai.analyze', oldFence)).resolves.toBe(false)
  })

  it('fails closed for missing membership, a role that cannot decide AI, or an inactive source', async () => {
    // The fixture member is the Organization's only AccountAdmin, which the
    // last-owner guard will not let a plain statement remove or demote.
    const removeMember = () =>
      withLastOwnerGuardDisabled(fixture.cleanupPool(), (client) =>
        client.query('DELETE FROM member WHERE "organizationId" = $1', [ORG]),
      )
    const setRole = (role: string) =>
      withLastOwnerGuardDisabled(fixture.cleanupPool(), (client) =>
        client.query(
          `UPDATE member SET role = $1 WHERE id = 'member-merchant-ai-store'`,
          [role],
        ),
      )

    await removeMember()
    await expect(store.mutate(command())).rejects.toMatchObject({
      code: 'membership_denied',
    })
    await db.execute(sql`
      INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
      VALUES ('member-merchant-ai-store', ${USER}, ${ORG}, 'member', now())
    `)
    await expect(store.mutate(command())).rejects.toMatchObject({
      code: 'membership_denied',
    })
    // Deciding AI is an AccountAdmin's alone: the PropertyManager role is refused
    // even with the current Property grant the fixture inserts.
    await setRole('admin')
    await expect(store.mutate(command())).rejects.toMatchObject({
      code: 'membership_denied',
    })
    await setRole('owner')
    await db.execute(sql`
      UPDATE properties SET lifecycle_state = 'suspended' WHERE id = ${PROPERTY}::uuid
    `)
    await expect(store.mutate(command())).rejects.toMatchObject({
      code: 'property_inactive',
    })
  })

  it('linearizes concurrent stale commands so exactly one transition commits', async () => {
    await store.mutate(command())
    const concurrentChange = store.mutate(
      change(1, 'concurrent-change', { capabilities: ['review_analysis'] }),
    )
    const revoke = store.mutate(
      command({
        operation: 'revoke',
        idempotencyKey: 'concurrent-revoke',
        expectedStateVersion: 1,
        state: 'revoked',
        capabilities: [],
        reasonCode: 'merchant_revoked',
      }),
    )
    const outcomes = await Promise.allSettled([concurrentChange, revoke])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    const snapshot = await store.getSnapshot({
      organizationId: ORG,
      propertyId: PROPERTY,
    })
    expect(snapshot?.stateVersion).toBe(2)
    expect(['enabled', 'revoked']).toContain(snapshot?.state)
  })

  it('rejects direct head/history mutation and supports a fresh disabled restore reset', async () => {
    const enabled = await store.mutate(command())
    await expect(
      db.execute(sql`
        UPDATE merchant_ai_enablement SET state_version = state_version + 1
        WHERE organization_id = ${ORG}
      `),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: 'merchant_ai_head_requires_transition_function',
      }),
    })
    await expect(
      db.execute(sql`
        DELETE FROM merchant_ai_consent_evidence WHERE organization_id = ${ORG}
      `),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'merchant_ai_history_is_append_only' }),
    })

    const reset = await store.restoreReset({
      organizationId: ORG,
      propertyId: PROPERTY,
      idempotencyKey: 'restore-safety-reset',
      expectedStateVersion: enabled.stateVersion,
      reasonCode: 'restore_safety',
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      routingPolicyVersion: 1,
      providerDeploymentProfileVersion: 'private-beta-global-v2',
      redactionProfileFamily: 'gbp-review-global-v1',
      now: NOW,
    })
    expect(reset).toMatchObject({
      state: 'disabled',
      capabilities: [],
      capabilityEpochs: {
        review_analysis: 1,
        reply_drafting: 1,
        property_trends: 1,
      },
      stateVersion: 1,
    })
    expect(reset.authorizationLineageId).not.toBe(enabled.authorizationLineageId)
    const evidence = await db.execute(sql`
      SELECT transition_kind, count(*)::int AS count
      FROM merchant_ai_consent_evidence
      WHERE organization_id = ${ORG}
      GROUP BY transition_kind
      ORDER BY transition_kind
    `)
    expect(evidence.rows).toEqual([
      { transition_kind: 'enable', count: 1 },
      { transition_kind: 'restore_reset', count: 1 },
    ])
    // A restore reset is not a merchant's consent, so it names no ceremony.
    const ceremonies = await db.execute(sql`
      SELECT transition_kind, ceremony_id IS NOT NULL AS has_ceremony
      FROM merchant_ai_consent_evidence
      WHERE organization_id = ${ORG}
      ORDER BY transition_kind
    `)
    expect(ceremonies.rows).toEqual([
      { transition_kind: 'enable', has_ceremony: true },
      { transition_kind: 'restore_reset', has_ceremony: false },
    ])
  })

  it('uses typed store errors', () => {
    expect(new MerchantAiAuthorizationStoreError('version_conflict', 'x')).toMatchObject({
      code: 'version_conflict',
      name: 'MerchantAiAuthorizationStoreError',
    })
  })
})
