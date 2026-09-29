// A GBP notification call through the whole in-process Google egress runtime:
// the permit in Postgres, quota / in-flight / grant coordination in Redis, the
// start_google_execution_permit SQL gate, and the gateway's own fetch.
//
// Regression for 2026-09-29 on closed-beta-v2. Both provider calls of the
// import's best-effort subscribe were refused before dispatch — first because
// no quota policy existed for the notification routes (admission-start
// `coordination_unavailable`), and behind that because the permit-start SQL
// admitted `property.connect_gbp` only for the Review-sync principal on
// `reviews.list` / `reviews.get`, so a notification permit would have been
// fenced `authorization_changed`. Only a test through the real SQL and the
// real coordinators sees both. `fetch` is stubbed: nothing leaves the process.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { Redis } from 'ioredis'
import { getEnv } from '#/shared/config/env'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  GOOGLE_NOTIFICATION_SYSTEM_PERMISSION_DIGEST,
  GOOGLE_NOTIFICATION_SYSTEM_PRINCIPAL,
  GOOGLE_REVIEW_SYNC_SYSTEM_PERMISSION_DIGEST,
  GOOGLE_REVIEW_SYNC_SYSTEM_PRINCIPAL,
} from '#/contexts/integration/application/google-review-sync-authorizer'
import {
  compileGoogleProviderRequest,
  type GoogleProviderRouteDescriptor,
} from '#/shared/google-provider-control/route-catalogue'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { createInProcessGoogleEgressRuntime } from './google-egress-runtime'

const ORGANIZATION_ID = 'org-google-egress-notifications-test'
const USER_ID = 'user-google-egress-notifications-test'
const MEMBER_ID = 'member-google-egress-notifications-test'
const CONNECTION_ID = '8e000000-0000-4000-8000-0000000000a1'
const PROPERTY_ID = '8f000000-0000-4000-8000-0000000000a1'
const ACCOUNT_ID = GOOGLE_REVIEW_PRIMARY_SEGMENTS.accountId
const PROJECT_FINGERPRINT = 'b'.repeat(64)
const GATEWAY_IDENTITY = 'google-egress-runtime-1'
const TOPIC = 'projects/repkey-project/topics/gbp-notifications'

type SystemPrincipal = Readonly<{ name: string; digest: string }>
const NOTIFICATION_PRINCIPAL: SystemPrincipal = {
  name: GOOGLE_NOTIFICATION_SYSTEM_PRINCIPAL,
  digest: GOOGLE_NOTIFICATION_SYSTEM_PERMISSION_DIGEST,
}
const REVIEW_SYNC_PRINCIPAL: SystemPrincipal = {
  name: GOOGLE_REVIEW_SYNC_SYSTEM_PRINCIPAL,
  digest: GOOGLE_REVIEW_SYNC_SYSTEM_PERMISSION_DIGEST,
}

const SUBSCRIBE: GoogleProviderRouteDescriptor = {
  routeKey: 'notifications.subscribe',
  accessToken: 'access-token',
  accountId: ACCOUNT_ID,
  pubsubTopic: TOPIC,
  notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'],
}
const READBACK: GoogleProviderRouteDescriptor = {
  routeKey: 'notifications.get',
  accessToken: 'access-token',
  accountId: ACCOUNT_ID,
}
const UNSUBSCRIBE: GoogleProviderRouteDescriptor = {
  routeKey: 'notifications.unsubscribe',
  accessToken: 'access-token',
  accountId: ACCOUNT_ID,
}
const REVIEW_LIST: GoogleProviderRouteDescriptor = {
  routeKey: 'reviews.list',
  accessToken: 'access-token',
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
}

let pool: Pool
let redis: Redis
let originalConnectGbpControl:
  | Readonly<{
      denied: boolean
      emergency_kill_version: string
      denied_at: Date | null
      drained_at: Date | null
      cleanup_drained_at: Date | null
    }>
  | undefined

const fetchStub = vi.fn(
  async () =>
    new Response(
      JSON.stringify({
        name: `accounts/${ACCOUNT_ID}/notificationSetting`,
        pubsubTopic: TOPIC,
        notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
)

function runtime() {
  return createInProcessGoogleEgressRuntime({
    pool,
    redis,
    nowMs: () => Date.now(),
    gatewayIdentity: GATEWAY_IDENTITY,
    credentialBindingKeys: `v1:${'11'.repeat(32)}`,
    grantKeys: `v1:${'22'.repeat(32)}`,
    logger: { warn: () => undefined },
  })
}

/** The permit the executor would issue for this call, persisted as admitted. */
async function admitSystemPermit(
  descriptor: GoogleProviderRouteDescriptor,
  bindCredential: (credential: string) => string,
  principal: SystemPrincipal,
  initiatorUserId: string | null = null,
): Promise<string> {
  const compiled = compileGoogleProviderRequest(descriptor, bindCredential)
  const permitId = randomUUID()
  const now = new Date()
  await pool.query(
    `INSERT INTO authorization_execution_permits (
      id, capability, organization_id, property_id, connection_id,
      initiator_user_id, operation_key, route_key, route_catalog_version,
      quota_policy_id, authorization_vector, state, admitted_at, start_deadline_at
    ) VALUES (
      $1, 'property.connect_gbp', $2, $3, $4, $12,
      $5, $6, $7, $8, $9::jsonb, 'admitted', $10, $11
    )`,
    [
      permitId,
      ORGANIZATION_ID,
      PROPERTY_ID,
      CONNECTION_ID,
      `provider.${compiled.routeKey}`,
      compiled.routeKey,
      compiled.catalogueVersion,
      compiled.admission.quotaPolicyId,
      JSON.stringify({
        executionPolicyVersion: 'beta-local-2',
        principalKind: 'system',
        systemPrincipal: principal.name,
        role: 'System',
        permissionVersion: null,
        permissionDigest: principal.digest,
        connectionLifecycleVersion: 1,
        connectionAccessVersion: 1,
        credentialGeneration: 1,
        propertySourceEpoch: 7,
        propertyProfileVersion: 8,
        propertyBindingState: 'active',
        propertyLifecycleState: 'active',
        propertyProfileSource: 'tenant_confirmed',
        propertyTimezoneConfirmed: true,
        requestBindingSha256: compiled.admission.requestBindingSha256,
        credentialBinding: compiled.admission.credentialBinding,
        projectFingerprint: PROJECT_FINGERPRINT,
        requestBodySha256: compiled.admission.requestBodySha256,
        requestBodyBytes: compiled.admission.requestBodyBytes,
      }),
      now,
      new Date(now.getTime() + 30_000),
      initiatorUserId,
    ],
  )
  return permitId
}

async function permitState(permitId: string): Promise<string | undefined> {
  const result = await pool.query<{ state: string }>(
    'SELECT state FROM authorization_execution_permits WHERE id = $1',
    [permitId],
  )
  return result.rows[0]?.state
}

beforeAll(async () => {
  const redisUrl = getEnv().REDIS_URL
  if (!redisUrl) throw new Error('REDIS_URL is required for this integration test')
  pool = new Pool({ connectionString: getEnv().DATABASE_URL })
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 })
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Google Egress Notifications', $1, now())
     ON CONFLICT (id) DO NOTHING`,
    [ORGANIZATION_ID],
  )
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Google Egress User', 'google-egress-notifications@example.com', true, now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [USER_ID],
  )
  await pool.query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', now())
     ON CONFLICT (id) DO NOTHING`,
    [MEMBER_ID, USER_ID, ORGANIZATION_ID],
  )
  await pool.query(
    `INSERT INTO google_connections (
       id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by,
       visibility, status, credential_use_state, lifecycle_version,
       access_version, credential_generation
     ) VALUES (
       $1, $2, 'google-egress-notifications-subject', 'encrypted-access',
       'encrypted-refresh', now() + interval '1 hour', ARRAY['test'], $3,
       'organization', 'active', 'active', 1, 1, 1
     ) ON CONFLICT (id) DO NOTHING`,
    [CONNECTION_ID, ORGANIZATION_ID, USER_ID],
  )
  await pool.query(
    `INSERT INTO properties (
      id, organization_id, name, slug, timezone, google_connection_id,
      gbp_account_id, gbp_location_id, profile_version,
      google_binding_state, profile_source, profile_confirmed_at,
      profile_confirmed_by, lifecycle_state, source_epoch
    ) VALUES (
      $1::uuid, $2, 'Notification property', $1::text, 'Europe/Sofia', $3,
      $4, '456', 8, 'active', 'tenant_confirmed', now(),
      $5, 'active', 7
    ) ON CONFLICT (id) DO NOTHING`,
    [PROPERTY_ID, ORGANIZATION_ID, CONNECTION_ID, ACCOUNT_ID, USER_ID],
  )
  const control = await pool.query<NonNullable<typeof originalConnectGbpControl>>(
    `SELECT denied, emergency_kill_version, denied_at, drained_at, cleanup_drained_at
       FROM capability_execution_control
      WHERE capability = 'property.connect_gbp'`,
  )
  originalConnectGbpControl = control.rows[0]
  await pool.query(
    `UPDATE capability_execution_control
        SET denied = false, denied_at = NULL, drained_at = NULL, cleanup_drained_at = NULL
      WHERE capability = 'property.connect_gbp'`,
  )
})

beforeEach(() => {
  fetchStub.mockClear()
  vi.stubGlobal('fetch', fetchStub)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await pool.query(
    'DELETE FROM authorization_execution_permits WHERE organization_id = $1',
    [ORGANIZATION_ID],
  )
})

afterAll(async () => {
  const prior = originalConnectGbpControl
  if (prior) {
    await pool.query(
      `UPDATE capability_execution_control
          SET denied = $1, emergency_kill_version = $2, denied_at = $3,
              drained_at = $4, cleanup_drained_at = $5
        WHERE capability = 'property.connect_gbp'`,
      [
        prior.denied,
        prior.emergency_kill_version,
        prior.denied_at,
        prior.drained_at,
        prior.cleanup_drained_at,
      ],
    )
  }
  await pool.query('DELETE FROM properties WHERE id = $1', [PROPERTY_ID])
  await pool.query('DELETE FROM google_connections WHERE id = $1', [CONNECTION_ID])
  await withLastOwnerGuardDisabled(pool, async (client) => {
    await client.query('DELETE FROM member WHERE id = $1', [MEMBER_ID])
    await client.query('DELETE FROM "user" WHERE id = $1', [USER_ID])
    await deleteTestOrganizations(client, [ORGANIZATION_ID])
  })
  redis.disconnect()
  await pool.end()
})

describe('in-process Google egress runtime — GBP notification routes', () => {
  it.each([
    ['notifications.subscribe', SUBSCRIBE, 'PATCH'],
    ['notifications.get', READBACK, 'GET'],
    ['notifications.unsubscribe', UNSUBSCRIBE, 'PATCH'],
  ] as const)(
    'sends %s for the notification principal and completes its permit',
    async (_routeKey, descriptor, method) => {
      const egress = runtime()
      const permitId = await admitSystemPermit(
        descriptor,
        egress.bindCredential,
        NOTIFICATION_PRINCIPAL,
      )

      const result = await egress.gateway.execute({
        permitId,
        descriptor,
        deadlineMs: Date.now() + 15_000,
      })

      expect(result).toMatchObject({ ok: true, status: 200 })
      expect(fetchStub).toHaveBeenCalledOnce()
      const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toContain(
        `https://mybusinessnotifications.googleapis.com/v1/accounts/${ACCOUNT_ID}/notificationSetting`,
      )
      expect(init.method).toBe(method)
      await expect(permitState(permitId)).resolves.toBe('completed')
    },
  )

  it('fences a notification route admitted under the Review-sync principal', async () => {
    const egress = runtime()
    const permitId = await admitSystemPermit(
      SUBSCRIBE,
      egress.bindCredential,
      REVIEW_SYNC_PRINCIPAL,
    )

    const result = await egress.gateway.execute({
      permitId,
      descriptor: SUBSCRIBE,
      deadlineMs: Date.now() + 15_000,
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'admission_denied',
      admissionCode: 'authorization_changed',
      dispatch: 'not_sent',
    })
    expect(fetchStub).not.toHaveBeenCalled()
    await expect(permitState(permitId)).resolves.toBe('fenced')
  })

  it.each([
    [
      'a forged principal digest',
      { name: GOOGLE_NOTIFICATION_SYSTEM_PRINCIPAL, digest: 'f'.repeat(64) },
      null,
    ],
    ['an initiating user', NOTIFICATION_PRINCIPAL, USER_ID],
  ] as const)(
    'fences a notification permit carrying %s',
    async (_label, principal, initiatorUserId) => {
      const egress = runtime()
      const permitId = await admitSystemPermit(
        SUBSCRIBE,
        egress.bindCredential,
        principal,
        initiatorUserId,
      )

      const result = await egress.gateway.execute({
        permitId,
        descriptor: SUBSCRIBE,
        deadlineMs: Date.now() + 15_000,
      })

      expect(result).toMatchObject({
        ok: false,
        code: 'admission_denied',
        admissionCode: 'authorization_changed',
      })
      expect(fetchStub).not.toHaveBeenCalled()
      await expect(permitState(permitId)).resolves.toBe('fenced')
    },
  )

  it('fences a Review read admitted under the notification principal', async () => {
    const egress = runtime()
    const permitId = await admitSystemPermit(
      REVIEW_LIST,
      egress.bindCredential,
      NOTIFICATION_PRINCIPAL,
    )

    const result = await egress.gateway.execute({
      permitId,
      descriptor: REVIEW_LIST,
      deadlineMs: Date.now() + 15_000,
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'admission_denied',
      admissionCode: 'authorization_changed',
    })
    expect(fetchStub).not.toHaveBeenCalled()
    await expect(permitState(permitId)).resolves.toBe('fenced')
  })
})
