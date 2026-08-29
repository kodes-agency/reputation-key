// BQC-4.3 — providerConfigFor: the composition root's single mapping from a
// logical provider reference (ProcessingTarget.provider, from the router's
// accepting Data Cell catalogue target) to provider endpoint construction config.
//
// Fail closed (ADR 0048/0031): an unknown, denied, or missing provider ref
// throws — there is no default endpoint to fall back to. The logical ref is
// never a URL callers could misuse; URLs exist only inside this mapping.

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  providerConfigFor,
  applyProviderEndpointOverrides,
  closeContainer,
} from '#/composition'
import type { Env } from '#/shared/config/env'

describe('providerConfigFor (BQC-4.3)', () => {
  it("maps the beta cell's 'gbp-default' ref to the current global GBP endpoints", () => {
    expect(providerConfigFor('gbp-default')).toEqual({
      gbpApiBaseUrl: 'https://mybusinessbusinessinformation.googleapis.com/v1',
      gbpAccountManagementBaseUrl:
        'https://mybusinessaccountmanagement.googleapis.com/v1',
      gbpPerformanceBaseUrl: 'https://businessprofileperformance.googleapis.com/v1',
      reviewsApiBaseUrl: 'https://mybusiness.googleapis.com/v4',
      notificationsApiBaseUrl: 'https://mybusinessnotifications.googleapis.com/v1',
      oauthTokenUrl: 'https://oauth2.googleapis.com/token',
      oauthJwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
      oauthRevokeUrl: 'https://oauth2.googleapis.com/revoke',
    })
  })

  it.each([undefined, '', 'gbp-europe', 'gbp-global', 'europe', 'gbp-secondary'])(
    'throws for the unapproved provider ref %s (fail closed — no fallback)',
    (ref) => {
      expect(() => providerConfigFor(ref)).toThrow(/provider/i)
    },
  )
})

describe('applyProviderEndpointOverrides (BQC-6.5 operator sandbox seam)', () => {
  const approved = providerConfigFor('gbp-default')
  /** Minimal env stand-in: only the override keys matter to the seam. */
  const envWith = (overrides: Partial<Record<string, string>>): Env =>
    overrides as unknown as Env

  it('passes the approved endpoints through byte-identically when every override is absent', () => {
    expect(applyProviderEndpointOverrides(approved, envWith({}))).toEqual(approved)
  })

  it('honors an explicit override for each endpoint independently', () => {
    const sandbox = 'http://localhost:4100'
    const overridden = applyProviderEndpointOverrides(
      approved,
      envWith({
        GBP_API_BASE_URL: `${sandbox}/gbp`,
        GBP_ACCOUNT_MANAGEMENT_BASE_URL: `${sandbox}/account-management`,
        GBP_PERFORMANCE_BASE_URL: `${sandbox}/performance`,
        GBP_REVIEWS_API_BASE_URL: `${sandbox}/reviews`,
        GBP_NOTIFICATIONS_API_BASE_URL: `${sandbox}/notifications`,
        GOOGLE_OAUTH_TOKEN_URL: `${sandbox}/oauth/token`,
        GOOGLE_OAUTH_JWKS_URL: `${sandbox}/oauth/jwks`,
        GOOGLE_OAUTH_REVOKE_URL: `${sandbox}/oauth/revoke`,
      }),
    )
    expect(overridden).toEqual({
      gbpApiBaseUrl: `${sandbox}/gbp`,
      gbpAccountManagementBaseUrl: `${sandbox}/account-management`,
      gbpPerformanceBaseUrl: `${sandbox}/performance`,
      reviewsApiBaseUrl: `${sandbox}/reviews`,
      notificationsApiBaseUrl: `${sandbox}/notifications`,
      oauthTokenUrl: `${sandbox}/oauth/token`,
      oauthJwksUrl: `${sandbox}/oauth/jwks`,
      oauthRevokeUrl: `${sandbox}/oauth/revoke`,
    })
  })

  it('overrides only the variables that are set, keeping the rest approved', () => {
    const overridden = applyProviderEndpointOverrides(
      approved,
      envWith({ GBP_REVIEWS_API_BASE_URL: 'http://localhost:4100' }),
    )
    expect(overridden.reviewsApiBaseUrl).toBe('http://localhost:4100')
    expect(overridden.gbpApiBaseUrl).toBe(approved.gbpApiBaseUrl)
    expect(overridden.oauthTokenUrl).toBe(approved.oauthTokenUrl)
  })

  // D1 (owner ruling, 2026-08-29): the local-sandbox PROFILE denial keys on the
  // deployed-cell signal RELEASE_MANIFEST_SHA256 ALONE — not on NODE_ENV —
  // because the local Compose stack runs the production images
  // (NODE_ENV=production) against the sandbox on purpose. The manifest digest
  // being ABSENT is what makes the local stack legal; it is also the guard's
  // accepted dark window before a service's first promotion.
  //
  // The OVERRIDE denial is deliberately wider than the deployed-cell signal:
  // it also fires for any NODE_ENV=production process that is not on the
  // local-sandbox profile, so a pre-promotion production cell cannot be pointed
  // at an arbitrary provider host while the deployed-cell signal is dark. The
  // NODE_ENV-unset / NODE_ENV=development cases below exist so that
  // reintroducing NODE_ENV as a REQUIRED conjunct of the deployed-cell signal
  // turns them red.
  const DEPLOYED_CELL_MANIFEST_SHA256 = 'a'.repeat(64)

  it('denies the local-sandbox profile in a deployed cell with NODE_ENV unset', () => {
    expect(() =>
      applyProviderEndpointOverrides(
        approved,
        envWith({
          RELEASE_MANIFEST_SHA256: DEPLOYED_CELL_MANIFEST_SHA256,
          GOOGLE_PROVIDER_ENDPOINT_PROFILE: 'local-sandbox',
        }),
      ),
    ).toThrow('deployed-cell local-sandbox profile is unavailable')
  })

  it('denies endpoint overrides in a deployed cell running NODE_ENV=development', () => {
    expect(() =>
      applyProviderEndpointOverrides(
        approved,
        envWith({
          NODE_ENV: 'development',
          RELEASE_MANIFEST_SHA256: DEPLOYED_CELL_MANIFEST_SHA256,
          GOOGLE_PROVIDER_ENDPOINT_PROFILE: 'production-fixed',
          GOOGLE_OAUTH_TOKEN_URL: 'https://attacker.test/oauth/token',
        }),
      ),
    ).toThrow('provider endpoint overrides are unavailable in a deployed cell')
  })

  // The dark window (no manifest digest yet) must not become an override hole:
  // GOOGLE_OAUTH_TOKEN_URL carries the client secret and the auth code, and the
  // route catalogue's production-origin allowlist never sees the OAuth adapter.
  it.each(['production-fixed', undefined])(
    'refuses overrides in a pre-promotion production cell on profile %s',
    (profile) => {
      expect(() =>
        applyProviderEndpointOverrides(
          approved,
          envWith({
            NODE_ENV: 'production',
            ...(profile === undefined
              ? {}
              : { GOOGLE_PROVIDER_ENDPOINT_PROFILE: profile }),
            GOOGLE_OAUTH_TOKEN_URL: 'https://attacker.test/oauth/token',
          }),
        ),
      ).toThrow('provider endpoint overrides require the local-sandbox profile')
    },
  )

  it('rejects arbitrary endpoint overrides in a deployed cell', () => {
    expect(() =>
      applyProviderEndpointOverrides(
        approved,
        envWith({
          NODE_ENV: 'production',
          RELEASE_MANIFEST_SHA256: DEPLOYED_CELL_MANIFEST_SHA256,
          GOOGLE_PROVIDER_ENDPOINT_PROFILE: 'production-fixed',
          GBP_API_BASE_URL: 'https://example.test',
        }),
      ),
    ).toThrow('provider endpoint overrides are unavailable in a deployed cell')
  })

  it('hard-denies the local-sandbox provider profile in a deployed cell', () => {
    expect(() =>
      applyProviderEndpointOverrides(
        approved,
        envWith({
          NODE_ENV: 'production',
          RELEASE_MANIFEST_SHA256: DEPLOYED_CELL_MANIFEST_SHA256,
          GOOGLE_PROVIDER_ENDPOINT_PROFILE: 'local-sandbox',
        }),
      ),
    ).toThrow('deployed-cell local-sandbox profile is unavailable')
  })

  it('still denies the profile in a deployed cell that also carries overrides', () => {
    expect(() =>
      applyProviderEndpointOverrides(
        approved,
        envWith({
          NODE_ENV: 'production',
          RELEASE_MANIFEST_SHA256: DEPLOYED_CELL_MANIFEST_SHA256,
          GOOGLE_PROVIDER_ENDPOINT_PROFILE: 'local-sandbox',
          GBP_API_BASE_URL: 'https://provider-sandbox:4100',
        }),
      ),
    ).toThrow('deployed-cell local-sandbox profile is unavailable')
  })

  it('admits the local Compose stack: production images, sandbox profile, no manifest digest', () => {
    // Exactly compose.local.yml's app environment for this seam.
    expect(
      applyProviderEndpointOverrides(
        approved,
        envWith({
          NODE_ENV: 'production',
          GOOGLE_PROVIDER_ENDPOINT_PROFILE: 'local-sandbox',
          GBP_ACCOUNT_MANAGEMENT_BASE_URL: 'https://provider-sandbox:4100/v1',
          GBP_API_BASE_URL: 'https://provider-sandbox:4100',
          GBP_PERFORMANCE_BASE_URL: 'http://provider-sandbox:4100',
          GBP_REVIEWS_API_BASE_URL: 'http://provider-sandbox:4100',
          GBP_NOTIFICATIONS_API_BASE_URL: 'http://provider-sandbox:4100',
          GOOGLE_OAUTH_TOKEN_URL: 'http://provider-sandbox:4100/oauth/token',
          GOOGLE_OAUTH_REVOKE_URL: 'http://provider-sandbox:4100/oauth/revoke',
        }),
      ),
    ).toEqual({
      gbpApiBaseUrl: 'https://provider-sandbox:4100',
      gbpAccountManagementBaseUrl: 'https://provider-sandbox:4100/v1',
      gbpPerformanceBaseUrl: 'http://provider-sandbox:4100',
      reviewsApiBaseUrl: 'http://provider-sandbox:4100',
      notificationsApiBaseUrl: 'http://provider-sandbox:4100',
      oauthTokenUrl: 'http://provider-sandbox:4100/oauth/token',
      // Unset by the stack — stays on the approved endpoint.
      oauthJwksUrl: approved.oauthJwksUrl,
      oauthRevokeUrl: 'http://provider-sandbox:4100/oauth/revoke',
    })
  })
})

// BQC-7.1 — closeContainer: the web graceful-shutdown path for the
// getContainer() singleton's BullMQ queues. The singleton lives on the
// process-wide Symbol.for store (the production build bundles composition
// twice), so tests seed the same well-known key — no test-only export.
describe('closeContainer (BQC-7.1)', () => {
  const CONTAINER_KEY = Symbol.for('repkey.composition.container')
  type SeededContainer = {
    jobQueue?: { close: () => Promise<void> }
    backgroundQueue?: { close: () => Promise<void> }
  }

  function seed(container: SeededContainer | undefined): void {
    if (container === undefined)
      delete (globalThis as Record<symbol, unknown>)[CONTAINER_KEY]
    else (globalThis as Record<symbol, unknown>)[CONTAINER_KEY] = container
  }

  afterEach(() => seed(undefined))

  it('no-ops when the singleton was never built', async () => {
    seed(undefined)
    await expect(closeContainer()).resolves.toBeUndefined()
  })

  it('closes both queues and resets the store (idempotent second call)', async () => {
    const jobQueue = { close: vi.fn(async () => undefined) }
    const backgroundQueue = { close: vi.fn(async () => undefined) }
    seed({ jobQueue, backgroundQueue })

    await closeContainer()

    expect(jobQueue.close).toHaveBeenCalledOnce()
    expect(backgroundQueue.close).toHaveBeenCalledOnce()
    // Store was reset — a second close is a no-op.
    await closeContainer()
    expect(jobQueue.close).toHaveBeenCalledOnce()
    expect(backgroundQueue.close).toHaveBeenCalledOnce()
  })

  it('tolerates a no-Redis container (queues absent)', async () => {
    seed({})
    await expect(closeContainer()).resolves.toBeUndefined()
  })
})
