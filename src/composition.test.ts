// BQC-4.3 — providerConfigFor: the composition root's single mapping from a
// logical provider reference (ProcessingTarget.provider, from the router's
// CELL_TARGETS) to provider endpoint construction config.
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
      reviewsApiBaseUrl: 'https://mybusiness.googleapis.com/v4',
      notificationsApiBaseUrl: 'https://mybusinessnotifications.googleapis.com/v1',
      oauthTokenUrl: 'https://oauth2.googleapis.com/token',
      oauthUserInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
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
        GBP_REVIEWS_API_BASE_URL: `${sandbox}/reviews`,
        GBP_NOTIFICATIONS_API_BASE_URL: `${sandbox}/notifications`,
        GOOGLE_OAUTH_TOKEN_URL: `${sandbox}/oauth/token`,
        GOOGLE_OAUTH_USERINFO_URL: `${sandbox}/oauth/userinfo`,
        GOOGLE_OAUTH_REVOKE_URL: `${sandbox}/oauth/revoke`,
      }),
    )
    expect(overridden).toEqual({
      gbpApiBaseUrl: `${sandbox}/gbp`,
      reviewsApiBaseUrl: `${sandbox}/reviews`,
      notificationsApiBaseUrl: `${sandbox}/notifications`,
      oauthTokenUrl: `${sandbox}/oauth/token`,
      oauthUserInfoUrl: `${sandbox}/oauth/userinfo`,
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
