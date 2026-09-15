import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '#/shared/db/schema'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { listMerchantAiOverview } from '../../application/use-cases/merchant-ai-overview'
import { resolveMemberPermissionPropertyScope } from './member-property-authority'
import { createMerchantAiOverviewReader } from './merchant-ai-overview.repository'

const ORG = `org-ai-overview-${randomUUID()}`
const OTHER_ORG = `org-ai-overview-other-${randomUUID()}`
const OWNER = `user-ai-overview-owner-${randomUUID()}`
const MANAGER = `user-ai-overview-manager-${randomUUID()}`
const OUTSIDER = `user-ai-overview-outsider-${randomUUID()}`
const CONNECTION = randomUUID()
const ALPHA = randomUUID()
const BETA = randomUUID()
const GAMMA = randomUUID()
const DELETED = randomUUID()
const FOREIGN = randomUUID()
const AT = new Date('2026-09-15T10:00:00.000Z')
const PREVIOUS_NOTICE_VERSION = 'merchant-ai-notice-2026-09-08.v1'
const PREVIOUS_NOTICE_DIGEST =
  'c24030bc98918d3fa6a8e820bf6bca6489a4c8835cf61bd12ab6b84a8f0a0865'

// One rolled-back transaction: the reader and the scope resolver open none.
let pool: Pool
let db: Database

async function insertProperty(
  input: Readonly<{
    id: string
    organization: string
    name: string
    bound: boolean
    deleted?: boolean
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, google_connection_id,
       gbp_account_id, gbp_location_id, google_binding_state, source_epoch, deleted_at
     ) VALUES ($1, $2, $3, $4, 'UTC', $5, $6, $7, $8, 0, $9)`,
    [
      input.id,
      input.organization,
      input.name,
      `overview-${input.id}`,
      input.bound ? CONNECTION : null,
      input.bound ? `account-${input.id}` : null,
      input.bound ? `location-${input.id}` : null,
      input.bound ? 'active' : 'unbound',
      input.deleted ? AT : null,
    ],
  )
}

async function transitionMerchantAi(
  input: Readonly<{
    property: string
    lineage: string
    kind: 'enable' | 'revoke'
    noticeVersion: string
    noticeDigest: string
  }>,
): Promise<void> {
  const enable = input.kind === 'enable'
  await pool.query(
    `SELECT (
       apply_merchant_ai_transition_v1(
         $1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8::text[], $9::jsonb,
         $10, $10, $10, 0, 0, $11, $12,
         'google-business-profile-source-policy-v1', 1, 'global',
         'private-beta-global-v1', 'gbp-review-global-v1', $13, $14, $15, $16, $17
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
      enable ? ['review_analysis', 'property_trends'] : [],
      enable
        ? '{"review_analysis":"review-analysis-runtime-v1","property_trends":"property-trends-runtime-v1"}'
        : '{}',
      enable ? 1 : 2,
      input.noticeVersion,
      input.noticeDigest,
      OWNER,
      enable ? 'merchant_enabled' : 'merchant_revoked',
      `overview-${input.kind}-${input.property}`,
      (enable ? 'c' : 'd').repeat(64),
      AT,
    ],
  )
}

async function insertGrant(
  property: string,
  state: Readonly<{ revokedAt?: Date; expiresAt?: Date }> = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO property_access_grant (
       organization_id, property_id, user_id, source, created_by, expires_at,
       revoked_at, revoke_reason
     ) VALUES ($1, $2, $3, 'operator', $4, $5, $6, $7)`,
    [
      ORG,
      property,
      MANAGER,
      OWNER,
      state.expiresAt ?? null,
      state.revokedAt ?? null,
      state.revokedAt ? 'operator_revoked' : null,
    ],
  )
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 1 })
  await pool.query('BEGIN')
  db = drizzle(pool, { schema }) as unknown as Database

  for (const id of [ORG, OTHER_ORG]) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Merchant AI overview', $1, $2)`,
      [id, AT],
    )
  }
  for (const [userId, role] of [
    [OWNER, 'owner'],
    [MANAGER, 'admin'],
  ] as const) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Overview Manager', $2, true, $3, $3)`,
      [userId, `${userId}@example.test`, AT],
    )
    await pool.query(
      `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
       VALUES ($1, $2, $3, $4, $5)`,
      [`member-${userId}`, userId, ORG, role, AT],
    )
  }
  await pool.query(
    `INSERT INTO google_connections (
       id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by,
       visibility, status
     ) VALUES ($1, $2, $3, 'sealed-access', 'sealed-refresh', now() + interval '1 hour',
               ARRAY['https://www.googleapis.com/auth/business.manage'], $4,
               'organization', 'active')`,
    [CONNECTION, ORG, `overview-subject-${randomUUID()}`, OWNER],
  )

  await insertProperty({ id: ALPHA, organization: ORG, name: 'alpha', bound: true })
  await insertProperty({ id: BETA, organization: ORG, name: 'Beta', bound: true })
  await insertProperty({ id: GAMMA, organization: ORG, name: 'gamma', bound: false })
  await insertProperty({
    id: DELETED,
    organization: ORG,
    name: 'deleted',
    bound: false,
    deleted: true,
  })
  await insertProperty({
    id: FOREIGN,
    organization: OTHER_ORG,
    name: 'Aardvark',
    bound: false,
  })

  for (const property of [ALPHA, BETA]) {
    await pool.query(
      `INSERT INTO review_ai_analysis_heads (organization_id, property_id, source_epoch, head_sequence)
       VALUES ($1, $2, 0, 0)`,
      [ORG, property],
    )
  }
  await transitionMerchantAi({
    property: ALPHA,
    lineage: randomUUID(),
    kind: 'enable',
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
  })
  const betaLineage = randomUUID()
  for (const kind of ['enable', 'revoke'] as const) {
    await transitionMerchantAi({
      property: BETA,
      lineage: betaLineage,
      kind,
      noticeVersion: PREVIOUS_NOTICE_VERSION,
      noticeDigest: PREVIOUS_NOTICE_DIGEST,
    })
  }
  await pool.query(
    `INSERT INTO merchant_ai_decision_deferrals (property_id, organization_id, deferred_by, deferred_at)
     VALUES ($1, $2, $3, $4)`,
    [BETA, ORG, OWNER, AT],
  )

  await insertGrant(BETA)
  await insertGrant(GAMMA, { revokedAt: new Date(AT.getTime() - 60_000) })
  await insertGrant(ALPHA, { expiresAt: new Date(AT.getTime() - 60_000) })
})

afterAll(async () => {
  await pool.query('ROLLBACK')
  await pool.end()
})

describe('Merchant AI overview reader', () => {
  it('reads every live Property of the Organization by name with its authorization head', async () => {
    await expect(
      createMerchantAiOverviewReader(db).listOverview({
        organizationId: ORG,
        propertyIds: null,
      }),
    ).resolves.toEqual([
      {
        propertyId: ALPHA,
        propertyName: 'alpha',
        googleBindingActive: true,
        authorization: {
          state: 'enabled',
          capabilities: ['review_analysis', 'property_trends'],
          noticeVersion: MERCHANT_AI_NOTICE_VERSION,
          noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        },
        decisionDeferredAt: null,
      },
      {
        propertyId: BETA,
        propertyName: 'Beta',
        googleBindingActive: true,
        authorization: {
          state: 'revoked',
          capabilities: [],
          noticeVersion: PREVIOUS_NOTICE_VERSION,
          noticeDigest: PREVIOUS_NOTICE_DIGEST,
        },
        decisionDeferredAt: AT,
      },
      {
        propertyId: GAMMA,
        propertyName: 'gamma',
        googleBindingActive: false,
        authorization: null,
        decisionDeferredAt: null,
      },
    ])
  })

  it('narrows to the exact Property set without crossing Organizations', async () => {
    const reader = createMerchantAiOverviewReader(db)

    await expect(
      reader.listOverview({ organizationId: ORG, propertyIds: [BETA, FOREIGN, DELETED] }),
    ).resolves.toEqual([expect.objectContaining({ propertyId: BETA })])
    await expect(
      reader.listOverview({ organizationId: ORG, propertyIds: [] }),
    ).resolves.toEqual([])
    await expect(
      reader.listOverview({ organizationId: OTHER_ORG, propertyIds: null }),
    ).resolves.toEqual([
      expect.objectContaining({ propertyId: FOREIGN, authorization: null }),
    ])
  })
})

describe('member permission Property scope', () => {
  const scopeFor = (organizationId: string, userId: string) =>
    resolveMemberPermissionPropertyScope(db, {
      organizationId,
      userId,
      permission: 'ai.manage',
      at: AT,
    })

  it('gives an AccountAdmin the whole Organization without reading grants', async () => {
    await expect(scopeFor(ORG, OWNER)).resolves.toEqual({ kind: 'organization' })
  })

  it('limits a PropertyManager to current grants, excluding revoked and expired ones', async () => {
    await expect(scopeFor(ORG, MANAGER)).resolves.toEqual({
      kind: 'properties',
      propertyIds: [BETA],
    })
  })

  it('denies a non-member and a member of another Organization', async () => {
    await expect(scopeFor(ORG, OUTSIDER)).resolves.toEqual({ kind: 'denied' })
    await expect(scopeFor(OTHER_ORG, MANAGER)).resolves.toEqual({ kind: 'denied' })
  })
})

describe('Organization AI overview', () => {
  const overview = listMerchantAiOverview({
    reader: {
      listOverview: (input) => createMerchantAiOverviewReader(db).listOverview(input),
    },
    resolveManagementScope: (input) =>
      resolveMemberPermissionPropertyScope(db, {
        organizationId: input.organizationId,
        userId: input.actorUserId,
        permission: 'ai.manage',
        at: input.now,
      }),
    clock: () => AT,
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
  })

  it('shows an AccountAdmin every Property with state, re-consent flag and deferral', async () => {
    const { properties } = await overview({ organizationId: ORG, actorUserId: OWNER })

    expect(properties).toEqual([
      {
        propertyId: ALPHA,
        propertyName: 'alpha',
        state: 'enabled',
        capabilities: ['review_analysis', 'property_trends'],
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        reconsentRequired: false,
        decisionDeferredAt: null,
        googleBindingActive: true,
      },
      {
        propertyId: BETA,
        propertyName: 'Beta',
        state: 'revoked',
        capabilities: [],
        noticeVersion: PREVIOUS_NOTICE_VERSION,
        reconsentRequired: true,
        decisionDeferredAt: AT.toISOString(),
        googleBindingActive: true,
      },
      {
        propertyId: GAMMA,
        propertyName: 'gamma',
        state: 'disabled',
        capabilities: [],
        noticeVersion: null,
        reconsentRequired: false,
        decisionDeferredAt: null,
        googleBindingActive: false,
      },
    ])
  })

  it('shows a PropertyManager only the Properties they may manage AI for', async () => {
    const { properties } = await overview({ organizationId: ORG, actorUserId: MANAGER })

    expect(properties.map((entry) => entry.propertyId)).toEqual([BETA])
  })

  it('refuses an actor outside the Organization', async () => {
    await expect(
      overview({ organizationId: ORG, actorUserId: OUTSIDER }),
    ).rejects.toMatchObject({ code: 'capability_denied' })
  })
})
