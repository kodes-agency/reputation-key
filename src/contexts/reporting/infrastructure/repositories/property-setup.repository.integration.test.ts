import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '#/shared/db/schema'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { createPropertySetupRepository } from './property-setup.repository'

const ORG = organizationId(`org-property-setup-${randomUUID()}`)
const OTHER_ORG = organizationId(`org-property-setup-other-${randomUUID()}`)
const OWNER = `user-property-setup-${randomUUID()}`
const CONNECTION = randomUUID()
const CONFIGURED = propertyId(randomUUID())
const BARE = propertyId(randomUUID())
const LAPSED = propertyId(randomUUID())
const DELETED = propertyId(randomUUID())
const FOREIGN = propertyId(randomUUID())
const AT = new Date('2026-09-01T10:00:00.000Z')

// Every statement below runs inside one transaction that is rolled back, and the
// repository reads without opening its own, so the fixture never persists.
let pool: Pool
let db: Database

async function insertProperty(
  input: Readonly<{
    id: string
    organization: string
    bound: boolean
    sourceEpoch: number
    replyLanguage: string | null
    deleted?: boolean
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, google_connection_id,
       gbp_account_id, gbp_location_id, google_binding_state,
       default_reply_language, source_epoch, deleted_at
     ) VALUES ($1, $2, 'Setup property', $3, 'UTC', $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.id,
      input.organization,
      `setup-${input.id}`,
      input.bound ? CONNECTION : null,
      input.bound ? `account-${input.id}` : null,
      input.bound ? `location-${input.id}` : null,
      input.bound ? 'active' : 'unbound',
      input.replyLanguage,
      input.sourceEpoch,
      input.deleted ? AT : null,
    ],
  )
}

async function insertSnapshotRun(
  property: string,
  sourceEpoch: number,
  state: 'completed' | 'failed' | 'scanning',
): Promise<void> {
  const terminal = state === 'scanning' ? null : AT
  await pool.query(
    `INSERT INTO review_provider_snapshot_runs (
       id, organization_id, property_id, source_epoch, state, phase,
       started_at, expires_at, terminal_at, record_expires_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $7::timestamptz + interval '1 day', $8,
       $8::timestamptz + interval '30 days', $7, $7
     )`,
    [
      randomUUID(),
      ORG,
      property,
      sourceEpoch,
      state,
      state === 'scanning' ? 'main' : 'terminal',
      AT,
      terminal,
    ],
  )
}

async function transitionMerchantAi(
  input: Readonly<{
    property: string
    lineage: string
    sourceEpoch: number
    kind: 'enable' | 'revoke'
  }>,
): Promise<void> {
  const enable = input.kind === 'enable'
  await pool.query(
    `SELECT (
       apply_merchant_ai_transition_v1(
         $1::uuid, $2, $3, $4, $5::uuid, $6, $7,
         $8::text[], $9::jsonb, $10, $10, $10, $11, 0, $12, $13,
         'google-business-profile-source-policy-v1', 1, 'global',
         'private-beta-global-v1', 'gbp-review-global-v1', $14,
         $15, $16, $17, $18
       )
     ).*`,
    [
      input.lineage,
      enable ? 0 : 1,
      enable ? 1 : 2,
      ORG,
      input.property,
      input.kind,
      enable ? 'enabled' : 'revoked',
      enable ? ['review_analysis', 'reply_drafting'] : [],
      enable
        ? '{"review_analysis":"review-analysis-runtime-v1","reply_drafting":"reply-drafting-runtime-v1"}'
        : '{}',
      enable ? 1 : 2,
      input.sourceEpoch,
      MERCHANT_AI_NOTICE_VERSION,
      MERCHANT_AI_NOTICE_DIGEST,
      OWNER,
      enable ? 'merchant_enabled' : 'merchant_revoked',
      `property-setup-${input.kind}-${input.property}`,
      (enable ? 'a' : 'b').repeat(64),
      AT,
    ],
  )
}

async function insertPortal(
  input: Readonly<{
    property: string
    publicationState: 'draft' | 'published' | 'disabled'
    activation: 'open' | 'closed' | 'none'
    deleted?: boolean
  }>,
): Promise<void> {
  const portal = randomUUID()
  const snapshot = randomUUID()
  await pool.query(
    `INSERT INTO portals (
       id, organization_id, property_id, entity_type, entity_id, name, slug,
       publication_state, created_at, updated_at, deleted_at
     ) VALUES ($1, $2, $3::uuid, 'property', $4, 'Lobby', $5, $6, $7, $7, $8)`,
    [
      portal,
      ORG,
      input.property,
      input.property,
      `lobby-${portal}`,
      input.publicationState,
      AT,
      input.deleted ? AT : null,
    ],
  )
  if (input.activation === 'none') return
  await pool.query(
    `INSERT INTO portal_publication_snapshots (
       id, organization_id, property_id, portal_id, version,
       configuration_digest, configuration, guest_locale,
       language_pack_version, private_feedback_threshold, destination_uri,
       destination_retrieved_at, destination_source_epoch,
       destination_profile_version, created_by, created_at
     ) VALUES (
       $1, $2, $3, $4, 1, repeat('a', 64), '{}'::jsonb, 'en',
       'guest-ui-en-v1', 3, 'https://example.test/review', $5, 0, 1, $6, $5
     )`,
    [snapshot, ORG, input.property, portal, AT, OWNER],
  )
  const closed = input.activation === 'closed'
  await pool.query(
    `INSERT INTO portal_publication_activations (
       id, organization_id, property_id, portal_id, snapshot_id,
       activation_sequence, kind, activated_by, activated_at,
       deactivated_at, deactivation_reason
     ) VALUES ($1, $2, $3, $4, $5, 1, 'publish', $6, $7, $8, $9)`,
    [
      randomUUID(),
      ORG,
      input.property,
      portal,
      snapshot,
      OWNER,
      AT,
      closed ? new Date(AT.getTime() + 60_000) : null,
      closed ? 'disabled' : null,
    ],
  )
}

async function insertManager(
  organization: string,
  property: string,
  endedAt: Date | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO property_responsible_managers (
       id, organization_id, property_id, user_id, effective_from, effective_to,
       created_by, end_reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $4, $7)`,
    [
      randomUUID(),
      organization,
      property,
      OWNER,
      AT,
      endedAt,
      endedAt ? 'replaced' : null,
    ],
  )
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 1 })
  await pool.query('BEGIN')
  db = drizzle(pool, { schema }) as unknown as Database

  for (const [id, slug] of [
    [ORG, `setup-${randomUUID()}`],
    [OTHER_ORG, `setup-other-${randomUUID()}`],
  ] as const) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Property setup test', $2, $3)`,
      [id, slug, AT],
    )
  }
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Setup Owner', $2, true, $3, $3)`,
    [OWNER, `${OWNER}@example.test`, AT],
  )
  await pool.query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', $4)`,
    [`member-${OWNER}`, OWNER, ORG, AT],
  )
  await pool.query(
    `INSERT INTO google_connections (
       id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by,
       visibility, status
     ) VALUES ($1, $2, $3, 'sealed-access', 'sealed-refresh', now() + interval '1 hour',
               ARRAY['https://www.googleapis.com/auth/business.manage'], $4,
               'organization', 'active')`,
    [CONNECTION, ORG, `setup-subject-${randomUUID()}`, OWNER],
  )

  // Every step holds.
  await insertProperty({
    id: CONFIGURED,
    organization: ORG,
    bound: true,
    sourceEpoch: 2,
    replyLanguage: 'en-Latn',
  })
  await insertSnapshotRun(CONFIGURED, 2, 'completed')
  await pool.query(
    `INSERT INTO review_ai_analysis_heads (organization_id, property_id, source_epoch, head_sequence)
     VALUES ($1, $2, 2, 0)`,
    [ORG, CONFIGURED],
  )
  await transitionMerchantAi({
    property: CONFIGURED,
    lineage: randomUUID(),
    sourceEpoch: 2,
    kind: 'enable',
  })
  await insertManager(ORG, CONFIGURED, null)
  await pool.query(
    `INSERT INTO property_reply_profiles (
       organization_id, property_id, greeting, sign_off_positive, sign_off_negative,
       updated_by
     ) VALUES ($1, $2, 'Hello', 'Thank you', 'We are sorry', $3)`,
    [ORG, CONFIGURED, OWNER],
  )
  await insertPortal({
    property: CONFIGURED,
    publicationState: 'published',
    activation: 'open',
  })

  // Nothing configured yet.
  await insertProperty({
    id: BARE,
    organization: ORG,
    bound: false,
    sourceEpoch: 0,
    replyLanguage: null,
  })

  // Every fact once held and no longer does, or never counted.
  await insertProperty({
    id: LAPSED,
    organization: ORG,
    bound: true,
    sourceEpoch: 3,
    replyLanguage: null,
  })
  await insertSnapshotRun(LAPSED, 2, 'completed') // a previous source epoch
  await insertSnapshotRun(LAPSED, 3, 'failed')
  await insertSnapshotRun(LAPSED, 3, 'scanning')
  await pool.query(
    `INSERT INTO review_ai_analysis_heads (organization_id, property_id, source_epoch, head_sequence)
     VALUES ($1, $2, 3, 0)`,
    [ORG, LAPSED],
  )
  const lapsedLineage = randomUUID()
  await transitionMerchantAi({
    property: LAPSED,
    lineage: lapsedLineage,
    sourceEpoch: 3,
    kind: 'enable',
  })
  await transitionMerchantAi({
    property: LAPSED,
    lineage: lapsedLineage,
    sourceEpoch: 3,
    kind: 'revoke',
  })
  await pool.query(
    `INSERT INTO merchant_ai_decision_deferrals (property_id, organization_id, deferred_by, deferred_at)
     VALUES ($1, $2, $3, $4)`,
    [LAPSED, ORG, OWNER, AT],
  )
  await insertManager(ORG, LAPSED, new Date(AT.getTime() + 60_000))
  await insertPortal({
    property: LAPSED,
    publicationState: 'published',
    activation: 'closed',
  })
  await insertPortal({
    property: LAPSED,
    publicationState: 'disabled',
    activation: 'open',
  })
  await insertPortal({
    property: LAPSED,
    publicationState: 'published',
    activation: 'open',
    deleted: true,
  })
  await insertPortal({ property: LAPSED, publicationState: 'draft', activation: 'none' })

  // Deleted Properties never appear, however configured.
  await insertProperty({
    id: DELETED,
    organization: ORG,
    bound: false,
    sourceEpoch: 0,
    replyLanguage: 'en-Latn',
    deleted: true,
  })

  // Another Organization's Property with facts of its own.
  await insertProperty({
    id: FOREIGN,
    organization: OTHER_ORG,
    bound: false,
    sourceEpoch: 0,
    replyLanguage: 'bg-Cyrl',
  })
  await insertManager(OTHER_ORG, FOREIGN, null)
})

afterAll(async () => {
  await pool.query('ROLLBACK')
  await pool.end()
})

describe('property setup repository', () => {
  it('reads every fact as held for a fully configured Property', async () => {
    await expect(
      createPropertySetupRepository(db).readPropertyFacts({
        organizationId: ORG,
        propertyId: CONFIGURED,
      }),
    ).resolves.toEqual({
      propertyId: CONFIGURED,
      googleBindingActive: true,
      reviewsSyncedForCurrentSource: true,
      replyLanguageChosen: true,
      merchantAiState: 'enabled',
      aiDecisionDeferred: false,
      responsibleManagerAssigned: true,
      replyVoiceConfigured: true,
      portalPublished: true,
    })
  })

  it('reads an untouched Property as unconfigured with AI never authorized', async () => {
    await expect(
      createPropertySetupRepository(db).readPropertyFacts({
        organizationId: ORG,
        propertyId: BARE,
      }),
    ).resolves.toEqual({
      propertyId: BARE,
      googleBindingActive: false,
      reviewsSyncedForCurrentSource: false,
      replyLanguageChosen: false,
      merchantAiState: 'disabled',
      aiDecisionDeferred: false,
      responsibleManagerAssigned: false,
      replyVoiceConfigured: false,
      portalPublished: false,
    })
  })

  it('counts only current evidence: source epoch, open manager interval, live publication', async () => {
    await expect(
      createPropertySetupRepository(db).readPropertyFacts({
        organizationId: ORG,
        propertyId: LAPSED,
      }),
    ).resolves.toEqual({
      propertyId: LAPSED,
      googleBindingActive: true,
      // Completed only for a previous epoch; the current epoch failed or is running.
      reviewsSyncedForCurrentSource: false,
      replyLanguageChosen: false,
      merchantAiState: 'revoked',
      aiDecisionDeferred: true,
      // The only manager interval has ended.
      responsibleManagerAssigned: false,
      replyVoiceConfigured: false,
      // Closed activation, disabled Portal, deleted Portal, unpublished draft.
      portalPublished: false,
    })
  })

  it('lists only live Properties of the Organization, in a stable order', async () => {
    const facts = await createPropertySetupRepository(db).listPropertyFacts({
      organizationId: ORG,
      accessiblePropertyIds: null,
    })

    expect(facts.map((fact) => fact.propertyId)).toEqual(
      [CONFIGURED, BARE, LAPSED].sort(),
    )
  })

  it('narrows the list to the exact accessible set and never crosses Organizations', async () => {
    const repository = createPropertySetupRepository(db)

    await expect(
      repository.listPropertyFacts({
        organizationId: ORG,
        accessiblePropertyIds: [BARE, FOREIGN, DELETED],
      }),
    ).resolves.toEqual([expect.objectContaining({ propertyId: BARE })])
    await expect(
      repository.listPropertyFacts({ organizationId: ORG, accessiblePropertyIds: [] }),
    ).resolves.toEqual([])
  })

  it('reads nothing for a deleted Property or another Organization', async () => {
    const repository = createPropertySetupRepository(db)

    await expect(
      repository.readPropertyFacts({ organizationId: ORG, propertyId: DELETED }),
    ).resolves.toBeNull()
    await expect(
      repository.readPropertyFacts({ organizationId: ORG, propertyId: FOREIGN }),
    ).resolves.toBeNull()
    await expect(
      repository.readPropertyFacts({ organizationId: OTHER_ORG, propertyId: FOREIGN }),
    ).resolves.toMatchObject({
      propertyId: FOREIGN,
      replyLanguageChosen: true,
      responsibleManagerAssigned: true,
    })
    await expect(
      repository.listPropertyFacts({
        organizationId: OTHER_ORG,
        accessiblePropertyIds: null,
      }),
    ).resolves.toEqual([expect.objectContaining({ propertyId: FOREIGN })])
  })
})
