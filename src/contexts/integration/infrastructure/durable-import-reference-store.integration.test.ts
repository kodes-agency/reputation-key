import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import type { ProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type {
  ImportDiscoveryAuthorization,
  ImportDiscoveryCandidate,
} from '../application/ports/google-import-reference-store.port'
import {
  createDurableImportReferenceKeys,
  invalidationScopeFor,
} from './durable-import-reference-keys'
import { createDurableGoogleImportReferenceStore } from './durable-import-reference-store'

const ORGANIZATION_ID = 'org-durable-google-import-discovery'
const USER_ID = 'user-durable-google-import-discovery'
const CONNECTION_ID = '82000000-0000-4000-8000-000000000001'
const FIRST_REQUEST_ID = '82000000-0000-4000-8000-000000000003'
const SECOND_REQUEST_ID = '82000000-0000-4000-8000-000000000004'
const START_MS = Date.parse('2026-08-27T10:00:00.000Z')
const DAY_MS = 24 * 60 * 60_000

const handleKeys = createVersionedHmacKeyring(`v1:${'31'.repeat(32)}`)
const leasePrincipalKeys = createVersionedHmacKeyring(`v1:${'32'.repeat(32)}`)
let randomCounter = 0
let leaseCounter = 0
let nowMs = START_MS

const random = (bytes: number): Buffer => {
  const result = Buffer.alloc(bytes)
  result.writeUInt32BE((randomCounter += 1), bytes - 4)
  return result
}

const leases: ProviderAuthorizationLeaseService = {
  issue: async (input) => ({
    ok: true,
    lease: {
      leaseRef: `test-lease-${(leaseCounter += 1)}`,
      expiresAt: new Date(
        Math.min(input.nowMs + 30_000, input.absoluteDeadlineMs),
      ).toISOString(),
      ttlSeconds: 30,
      renewAfterMs: 10_000,
    },
  }),
  renew: async (input) => ({
    ok: true,
    lease: {
      leaseRef: input.leaseRef,
      expiresAt: new Date(input.nowMs + 30_000).toISOString(),
      ttlSeconds: 30,
      renewAfterMs: 10_000,
    },
  }),
  invalidate: async () => {},
}

const authorization = (
  overrides: Partial<ImportDiscoveryAuthorization> = {},
): ImportDiscoveryAuthorization => ({
  organizationId: ORGANIZATION_ID,
  userId: USER_ID,
  connectionId: CONNECTION_ID,
  connectionLifecycleVersion: 3,
  connectionAccessVersion: 5,
  credentialGeneration: 7,
  authorizationVector: Object.freeze({ policyVersion: 11, permissionVersion: 13 }),
  ...overrides,
})

const createStore = () =>
  createDurableGoogleImportReferenceStore({
    db: getDb(),
    handleKeys,
    leasePrincipalKeys,
    leases,
    clock: () => new Date(nowMs),
    random,
  })

const account = Object.freeze({
  accountId: 'durable-account',
  displayName: 'Durable account',
  role: 'owner' as const,
})

const candidates = (start: number, count: number): ImportDiscoveryCandidate[] =>
  Array.from({ length: count }, (_, offset) => ({
    accountId: account.accountId,
    locationId: `durable-location-${start + offset}`,
    accountDisplayName: account.displayName,
    businessName: `Durable business ${start + offset}`,
    address: `${start + offset} Example Street`,
    primaryCategory: 'Hotel',
    countryCode: 'US',
    eligibility: { kind: 'create' as const },
  }))

describe('durable Google import discovery checkpoint', () => {
  let lease: TestLease
  const invalidationKeys = createDurableImportReferenceKeys({
    keys: handleKeys,
  }).invalidationKeys(
    invalidationScopeFor('connection', [ORGANIZATION_ID, CONNECTION_ID]),
  )

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    await lease.pool.query('DELETE FROM google_connections WHERE organization_id = $1', [
      ORGANIZATION_ID,
    ])
    await lease.pool.query(
      `INSERT INTO google_connections (
         id, organization_id, google_subject, encrypted_access_token,
         encrypted_refresh_token, token_expires_at, scopes, connected_by,
         credential_authorized_by, credential_authorized_at, visibility,
         status, credential_use_state, lifecycle_version, access_version,
         credential_generation
       ) VALUES (
         $1, $2, $3, 'access', 'refresh', now() + interval '1 hour',
         ARRAY['scope']::text[], $4, $4, now(), 'organization', 'active',
         'active', 3, 5, 7
       )`,
      [CONNECTION_ID, ORGANIZATION_ID, 'durable-subject', USER_ID],
    )
  })

  beforeEach(async () => {
    nowMs = START_MS
    await lease.pool.query(
      'DELETE FROM google_import_discovery_records WHERE organization_id = $1',
      [ORGANIZATION_ID],
    )
    await lease.pool.query(
      `DELETE FROM idempotency_receipts
       WHERE scope = 'google_import_discovery' AND key = ANY($1::text[])`,
      [invalidationKeys.map((item) => item.key)],
    )
  })

  afterAll(async () => {
    await lease?.pool.query('DELETE FROM google_connections WHERE organization_id = $1', [
      ORGANIZATION_ID,
    ])
    await lease?.pool.query(
      `DELETE FROM idempotency_receipts
       WHERE scope = 'google_import_discovery' AND key = ANY($1::text[])`,
      [invalidationKeys.map((item) => item.key)],
    )
    await lease?.release()
    handleKeys.dispose()
    leasePrincipalKeys.dispose()
  })

  it('resumes account references and bounded cursors after store recreation', async () => {
    const published = await createStore().publishAccountPage({
      authorization: authorization(),
      accounts: [account],
      nextPageToken: 'next-accounts-page',
      contentDeadlineMs: nowMs + DAY_MS,
      cursorRedemptionBudget: 2,
    })
    expect(published.ok).toBe(true)
    if (!published.ok || !published.value.nextCursor) return

    const recreated = createStore()
    await expect(
      recreated.resolveAccount({
        accountRef: published.value.items[0]!.accountRef,
        authorization: authorization(),
      }),
    ).resolves.toMatchObject({ ok: true, accountId: account.accountId })
    await expect(
      recreated.resolveAccount({
        accountRef: published.value.items[0]!.accountRef,
        authorization: authorization({ connectionAccessVersion: 6 }),
      }),
    ).resolves.toEqual({ ok: false, code: 'binding_mismatch' })
    for (let redemption = 0; redemption < 2; redemption += 1) {
      await expect(
        recreated.redeemAccountsCursor({
          cursorRef: published.value.nextCursor,
          authorization: authorization(),
        }),
      ).resolves.toMatchObject({ ok: true, pageToken: 'next-accounts-page' })
    }
    await expect(
      recreated.redeemAccountsCursor({
        cursorRef: published.value.nextCursor,
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'budget_exhausted' })

    await expect(
      recreated.publishAccountPage({
        authorization: authorization(),
        accounts: [],
        nextPageToken: null,
        contentDeadlineMs: nowMs + DAY_MS,
      }),
    ).resolves.toMatchObject({ ok: true, value: { items: [], nextCursor: null } })
  })

  it('claims, releases, and consumes an exact candidate set transactionally', async () => {
    const store = createStore()
    const accountsPage = await store.publishAccountPage({
      authorization: authorization(),
      accounts: [account],
      nextPageToken: null,
      contentDeadlineMs: nowMs + DAY_MS,
    })
    expect(accountsPage.ok).toBe(true)
    if (!accountsPage.ok) return
    const candidatePage = await store.publishCandidatePage({
      authorization: authorization(),
      account: {
        accountRef: accountsPage.value.items[0]!.accountRef,
        accountId: account.accountId,
        displayName: account.displayName,
      },
      candidates: candidates(0, 2),
      nextPageToken: null,
      contentDeadlineMs: nowMs + DAY_MS,
    })
    expect(candidatePage.ok).toBe(true)
    if (!candidatePage.ok) return
    const refs = candidatePage.value.items.map((item) => item.candidateRef!)
    const recreated = createStore()
    const claim = {
      candidateRefs: refs,
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      requestId: FIRST_REQUEST_ID,
    }

    const firstClaim = await recreated.claimCandidates(claim)
    expect(firstClaim).toMatchObject({ ok: true })
    if (!firstClaim.ok) return
    expect(firstClaim.candidates.map((item) => item.candidate.locationId)).toEqual([
      'durable-location-0',
      'durable-location-1',
    ])
    await expect(recreated.claimCandidates(claim)).resolves.toMatchObject({ ok: true })
    await expect(
      recreated.claimCandidates({ ...claim, requestId: SECOND_REQUEST_ID }),
    ).resolves.toEqual({ ok: false, code: 'binding_mismatch' })
    await expect(recreated.releaseCandidateClaims(claim)).resolves.toBe(true)
    const secondClaim = { ...claim, requestId: SECOND_REQUEST_ID }
    await expect(recreated.claimCandidates(secondClaim)).resolves.toMatchObject({
      ok: true,
    })
    await expect(recreated.consumeCandidateClaims(secondClaim)).resolves.toBe(true)
    await expect(
      recreated.resolveCandidate({
        candidateRef: refs[0]!,
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'not_found' })
  })

  it('fences invalidation races and fails expired references closed', async () => {
    const store = createStore()
    const first = await store.publishAccountPage({
      authorization: authorization(),
      accounts: [account],
      nextPageToken: null,
      contentDeadlineMs: nowMs + DAY_MS,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    await expect(
      store.invalidateConnection({
        organizationId: ORGANIZATION_ID,
        connectionId: CONNECTION_ID,
      }),
    ).resolves.toBe(true)
    await expect(
      store.resolveAccount({
        accountRef: first.value.items[0]!.accountRef,
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'not_found' })
    await expect(
      store.publishAccountPage({
        authorization: authorization(),
        accounts: [account],
        nextPageToken: null,
        contentDeadlineMs: nowMs + DAY_MS,
      }),
    ).resolves.toEqual({ ok: false, code: 'binding_mismatch' })

    nowMs += 31_000
    const expiring = await store.publishAccountPage({
      authorization: authorization(),
      accounts: [account],
      nextPageToken: null,
      contentDeadlineMs: nowMs + 1_000,
    })
    expect(expiring.ok).toBe(true)
    if (!expiring.ok) return
    nowMs += 1_001
    await expect(
      store.resolveAccount({
        accountRef: expiring.value.items[0]!.accountRef,
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'expired' })
  })

  it('checkpoints more than 2,000 candidates without a fleet-total cap', async () => {
    const store = createStore()
    const accountsPage = await store.publishAccountPage({
      authorization: authorization(),
      accounts: [account],
      nextPageToken: null,
      contentDeadlineMs: nowMs + DAY_MS,
    })
    expect(accountsPage.ok).toBe(true)
    if (!accountsPage.ok) return
    const accountRef = accountsPage.value.items[0]!.accountRef

    for (let page = 0; page < 21; page += 1) {
      const published = await store.publishCandidatePage({
        authorization: authorization(),
        account: {
          accountRef,
          accountId: account.accountId,
          displayName: account.displayName,
        },
        candidates: candidates(page * 100, 100),
        nextPageToken: null,
        contentDeadlineMs: nowMs + DAY_MS,
      })
      expect(published.ok).toBe(true)
    }
    const count = await lease.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM google_import_discovery_records
        WHERE organization_id = $1 AND audience = 'import_candidate'`,
      [ORGANIZATION_ID],
    )
    expect(count.rows[0]?.count).toBe('2100')
  })
})
