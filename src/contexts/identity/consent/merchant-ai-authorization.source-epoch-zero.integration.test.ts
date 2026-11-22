import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db/index'
import { properties } from '#/shared/db/schema/index'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { createMerchantAiAuthorizationStore } from './merchant-ai-authorization.repository.server'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { seedGoogleConnection } from '#/shared/testing/google-connection-seed'
import { drizzleSeedRunner } from '#/shared/db/testing/drizzle-seed-runner'

// Enabling AI on a freshly imported property once failed with
// `Invalid Merchant AI source_epoch row`: the store read the property's
// `source_epoch` with a minimum of 1, while `properties.source_epoch` starts at
// 0 and only advances on a timezone change, a soft delete, or a region move.
// The database guards had already been corrected; these application-layer
// reads had not, and no test covered the transition against a real database,
// so the failure only surfaced when an owner typed their password. Fixtures are
// distinct from the suite above and from the AI foundation adapter suite:
// integration files share one PostgreSQL database and may run concurrently.
const EPOCH_ZERO_ORGANIZATION_ID = 'merchant-ai-epoch-zero-org'
const EPOCH_ZERO_PROPERTY_ID = '73a00000-0000-4000-8000-000000000001'
const EPOCH_ZERO_CONNECTION_ID = '73a00000-0000-4000-8000-000000000002'
const EPOCH_ZERO_ACTOR_USER_ID = 'merchant-ai-epoch-zero-user'
const EPOCH_ZERO_NOW = new Date('2026-08-19T12:00:00.000Z')

describe('Merchant AI authorization store at source epoch 0', () => {
  const db = getDb()
  const store = createMerchantAiAuthorizationStore(db, randomUUID, replyScopeEffects)

  const clear = async () => {
    // Consent evidence is append-only and the enablement row is transition
    // guarded. Each statement runs on its own so a failure cannot poison a
    // transaction and leave the triggers disabled.
    for (const statement of [
      sql`ALTER TABLE merchant_ai_consent_evidence DISABLE TRIGGER USER`,
      sql`ALTER TABLE merchant_ai_enablement DISABLE TRIGGER USER`,
      // Enablement first: it FKs the evidence row it was minted from.
      sql`DELETE FROM merchant_ai_enablement WHERE organization_id = ${EPOCH_ZERO_ORGANIZATION_ID}`,
      sql`DELETE FROM merchant_ai_consent_evidence WHERE organization_id = ${EPOCH_ZERO_ORGANIZATION_ID}`,
      sql`ALTER TABLE merchant_ai_enablement ENABLE TRIGGER USER`,
      sql`ALTER TABLE merchant_ai_consent_evidence ENABLE TRIGGER USER`,
    ]) {
      await db.execute(statement)
    }
    await db.delete(properties).where(eq(properties.id, EPOCH_ZERO_PROPERTY_ID))
    await db.execute(
      sql`DELETE FROM google_connections WHERE organization_id = ${EPOCH_ZERO_ORGANIZATION_ID}`,
    )
    await db.execute(
      sql`DELETE FROM review_ai_analysis_heads WHERE organization_id = ${EPOCH_ZERO_ORGANIZATION_ID}`,
    )
    // `guard_last_owner` refuses to remove the org's only owner, so the fixture
    // teardown has to suspend it the same way the AI store tests do.
    await executeWithLastOwnerGuardDisabled(db, [
      sql`DELETE FROM member WHERE "organizationId" = ${EPOCH_ZERO_ORGANIZATION_ID}`,
    ])
    await db.execute(sql`DELETE FROM "user" WHERE id = ${EPOCH_ZERO_ACTOR_USER_ID}`)
    await deleteTestOrganizations(db, [EPOCH_ZERO_ORGANIZATION_ID])
  }

  beforeAll(async () => {
    await clear()
    // The store writes an outbox row, and the allowlist registry is installed by
    // composition in a running service — not by a bare test process.
    registerAllEventSchemas()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${EPOCH_ZERO_ORGANIZATION_ID}, 'Merchant AI epoch zero', ${EPOCH_ZERO_ORGANIZATION_ID}, ${EPOCH_ZERO_NOW})
    `)
    // The transition takes a `FOR SHARE` lock on the actor's membership row and
    // refuses without one.
    await db.execute(sql`
      INSERT INTO "user" (id, name, email, "emailVerified")
      VALUES (${EPOCH_ZERO_ACTOR_USER_ID}, 'Epoch zero owner', ${`${EPOCH_ZERO_ACTOR_USER_ID}@example.test`}, true)
    `)
    await db.execute(sql`
      INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
      VALUES (${`${EPOCH_ZERO_ACTOR_USER_ID}-member`}, ${EPOCH_ZERO_ORGANIZATION_ID}, ${EPOCH_ZERO_ACTOR_USER_ID}, 'owner', ${EPOCH_ZERO_NOW})
    `)
    // `properties_google_binding_tuple_valid` requires a connection plus account
    // and location ids whenever the binding is `active`, and `enable` refuses a
    // property whose Google source is not active — so the connection lands first.
    await seedGoogleConnection(drizzleSeedRunner(db), {
      id: EPOCH_ZERO_CONNECTION_ID,
      organizationId: EPOCH_ZERO_ORGANIZATION_ID,
      googleSubject: 'google-subject-epoch-zero',
      accessToken: 'encrypted-access',
      refreshToken: 'encrypted-refresh',
      tokenExpiresAt: EPOCH_ZERO_NOW,
      connectedBy: EPOCH_ZERO_ACTOR_USER_ID,
    })
    await db.insert(properties).values({
      id: EPOCH_ZERO_PROPERTY_ID,
      organizationId: EPOCH_ZERO_ORGANIZATION_ID,
      name: 'Epoch zero property',
      slug: 'epoch-zero-property',
      timezone: 'Europe/Sofia',
      countryCode: 'BG',
      profileVersion: 1,
      // The value a freshly imported property carries.
      sourceEpoch: 0,
      googleBindingState: 'active',
      googleConnectionId: EPOCH_ZERO_CONNECTION_ID,
      gbpAccountId: '117637856120281336154',
      gbpLocationId: '15441257785345231365',
    })
    // `enable` fences the analysis watermark against the current head for the
    // authorized epoch, so the head has to exist at epoch 0 as well.
    await db.execute(sql`
      INSERT INTO review_ai_analysis_heads
        (organization_id, property_id, source_epoch, head_sequence, created_at, updated_at)
      VALUES (${EPOCH_ZERO_ORGANIZATION_ID}, ${EPOCH_ZERO_PROPERTY_ID}::uuid, 0, 256, ${EPOCH_ZERO_NOW}, ${EPOCH_ZERO_NOW})
    `)
  })

  afterAll(clear)

  const enableCommand = (idempotencyKey: string) =>
    ({
      organizationId: EPOCH_ZERO_ORGANIZATION_ID,
      propertyId: EPOCH_ZERO_PROPERTY_ID,
      actorUserId: EPOCH_ZERO_ACTOR_USER_ID,
      idempotencyKey,
      expectedStateVersion: 0,
      operation: 'enable' as const,
      state: 'enabled' as const,
      capabilities: ['review_analysis'] as const,
      reasonCode: 'merchant_enabled',
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      routingPolicyVersion: 1,
      providerDeploymentProfileVersion: 'private-beta-global-v2' as const,
      redactionProfileFamily: 'gbp-review-global-v1',
      now: EPOCH_ZERO_NOW,
      ceremonyId: randomUUID(),
    }) satisfies Parameters<typeof store.mutate>[0]

  it('enables AI on a property at the domain default source epoch of 0', async () => {
    const snapshot = await store.mutate(enableCommand('epoch-zero-enable-1'))

    expect(snapshot.state).toBe('enabled')
    expect(snapshot.authorizedSourceEpoch).toBe(0)
    expect(snapshot.capabilities).toEqual(['review_analysis'])

    const enablement = await db.execute(sql`
      SELECT authorized_source_epoch, state, state_version
      FROM merchant_ai_enablement
      WHERE organization_id = ${EPOCH_ZERO_ORGANIZATION_ID} AND property_id = ${EPOCH_ZERO_PROPERTY_ID}::uuid
    `)
    expect(enablement.rows[0]).toMatchObject({
      authorized_source_epoch: 0,
      state: 'enabled',
    })

    // The consent evidence is what the runtime fences every AI operation
    // against, so it has to carry the same epoch.
    const evidence = await db.execute(sql`
      SELECT authorized_source_epoch
      FROM merchant_ai_consent_evidence
      WHERE organization_id = ${EPOCH_ZERO_ORGANIZATION_ID} AND property_id = ${EPOCH_ZERO_PROPERTY_ID}::uuid
    `)
    expect(evidence.rows[0]).toMatchObject({ authorized_source_epoch: 0 })
  })

  it('reads the enabled snapshot back without rejecting its epoch', async () => {
    // The snapshot mapper read `authorized_source_epoch` with a minimum of 1
    // too, so even a successful enable would have made every later read throw.
    const snapshot = await store.getSnapshot({
      organizationId: EPOCH_ZERO_ORGANIZATION_ID,
      propertyId: EPOCH_ZERO_PROPERTY_ID,
    })

    expect(snapshot).toMatchObject({ state: 'enabled', authorizedSourceEpoch: 0 })
  })

  it('replays an identical enable command idempotently', async () => {
    const snapshot = await store.mutate(enableCommand('epoch-zero-enable-1'))

    expect(snapshot).toMatchObject({ state: 'enabled', authorizedSourceEpoch: 0 })
    const evidence = await db.execute(sql`
      SELECT count(*)::int AS rows
      FROM merchant_ai_consent_evidence
      WHERE organization_id = ${EPOCH_ZERO_ORGANIZATION_ID}
    `)
    expect(evidence.rows[0]).toMatchObject({ rows: 1 })
  })
})
