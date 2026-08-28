// REL-01 Promotion step 4 — the production target guard for deployed journeys.
//
// Everything else under e2e/ points at the local Docker stack, owns a seeded
// database, and mutates freely. This directory is the one exception: it drives
// a browser against the LIVE production cell-us origin. The guard below exists
// because the difference between those two situations is one environment
// variable, and getting it wrong means running a mutating suite against real
// customer data.
//
// Three refusals, all fail-closed:
//   1. an absent DEPLOYED_BASE_URL is a refusal, never a fallback to
//      http://localhost:3000 (Playwright's `use.baseURL` default);
//   2. any origin other than the single production cell-us origin is refused,
//      including look-alikes and any path/query suffix;
//   3. an Organization id that is not the approved synthetic Organization is
//      refused, so a journey cannot touch a real tenant even by typo.
//
// This module must stay free of seed/fixture imports. e2e/deployed/*.test.ts
// asserts that no file in this directory can reach the mutating helpers, which
// is what makes "the local suite can never be aimed at production" a structural
// property rather than a convention.

export const DEPLOYED_PRODUCTION_ORIGIN = 'https://us.reputationkey.app' as const

/** The isolated Playwright project the release runner is allowed to invoke. */
export const DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT_NAME = 'deployed-critical' as const

/**
 * The project definition consumed by playwright.config.ts.
 *
 * `retries: 0` and `workers: 1` are not tuning: the evidence schema pins
 * `attempts: 1, retries: 0`, so a retried deployed run cannot produce valid
 * evidence at all. There is deliberately NO `dependencies: ['setup']` — the
 * setup project asserts the local seed state, which does not exist (and must
 * not exist) for a production target.
 */
export const DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT = {
  name: DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT_NAME,
  testMatch: /deployed\/.*\.spec\.ts/,
  retries: 0,
  workers: 1,
  // No `use.baseURL`: resolving it here would either default to localhost or
  // throw at config load for every local run. The spec resolves the target
  // through deployedTarget() at test time instead.
} as const

export type DeployedTarget = Readonly<{
  baseUrl: string
  syntheticOrganizationId: string
}>

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/**
 * Resolve and prove the deployed target. Throws — a deployed journey that
 * cannot prove its target must not run at all.
 */
export function deployedTarget(
  env: Readonly<Record<string, string | undefined>>,
): DeployedTarget {
  const baseUrl = env.DEPLOYED_BASE_URL
  if (!baseUrl) {
    throw new Error(
      'DEPLOYED_BASE_URL is not set. The deployed journey suite refuses to fall back to a ' +
        'default origin; set it to exactly ' +
        DEPLOYED_PRODUCTION_ORIGIN,
    )
  }
  if (baseUrl !== DEPLOYED_PRODUCTION_ORIGIN) {
    throw new Error(
      `DEPLOYED_BASE_URL=${baseUrl} is not the production cell-us origin. ` +
        `Deployed journey evidence is only meaningful against ${DEPLOYED_PRODUCTION_ORIGIN}.`,
    )
  }

  const syntheticOrganizationId = env.DEPLOYED_SYNTHETIC_ORGANIZATION_ID
  if (!syntheticOrganizationId || !UUID_PATTERN.test(syntheticOrganizationId)) {
    throw new Error(
      'DEPLOYED_SYNTHETIC_ORGANIZATION_ID must be the approved synthetic Organization id ' +
        'from the authorization artifact.',
    )
  }

  return { baseUrl, syntheticOrganizationId }
}

/**
 * Refuse any Organization that is not the approved synthetic one. Called before
 * a journey touches an Organization-scoped surface.
 */
export function assertApprovedSyntheticOrganization(
  organizationId: string,
  target: DeployedTarget,
): string {
  if (organizationId !== target.syntheticOrganizationId) {
    throw new Error(
      `Organization ${organizationId} is not the approved synthetic Organization ` +
        `${target.syntheticOrganizationId}. Deployed journeys may not touch a real tenant.`,
    )
  }
  return organizationId
}

/** Absolute URL builder — deployed journeys never rely on a relative baseURL. */
export function deployedUrl(target: DeployedTarget, path: string): string {
  if (!path.startsWith('/')) throw new Error(`deployed path must be absolute: ${path}`)
  return `${target.baseUrl}${path}`
}
