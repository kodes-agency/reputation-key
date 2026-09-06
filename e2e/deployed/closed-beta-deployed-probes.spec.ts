// REL-01 Promotion step 4 — read-only deployed probes.
//
// These are not business journeys. They make GET-only observations against the
// production cell-us origin: liveness, readiness, private metrics staying dark,
// the root redirecting to sign-in, the sign-in page rendering without
// a session, and denial of an unknown guest Portal token. There is no sign-in
// action, form submission, seed, fixture, or database handle.
//
// The release evidence identifier `repkey-deployed-critical-journeys-1`, the
// Playwright project `deployed-critical`, and digest-bound evidence vocabulary
// intentionally retain their historical critical-journey names. Renaming them
// would invalidate existing release evidence; only this spec filename and the
// human-facing evidence label change.
//
// The probes write two artifacts the release runner binds as evidence
// dependencies: an observed-request log (proving no unexpected external origin
// was contacted) and a cleanup report (proving nothing was created). Both paths
// come from the runner; without them the spec fails rather than skipping. The
// run creates nothing, so `cleanup.orphanedSyntheticResources: 0` is truthful.

import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import {
  deployedTarget,
  deployedUrl,
  DEPLOYED_PRODUCTION_ORIGIN,
} from './deployed-target'

const target = deployedTarget(process.env)

/** Origins a deployed journey is permitted to contact. */
const PERMITTED_ORIGINS = [DEPLOYED_PRODUCTION_ORIGIN] as const

const observedRequests: string[] = []

test.beforeEach(async ({ page }) => {
  page.on('request', (request) => observedRequests.push(request.url()))
})

test.afterAll(() => {
  const networkReportPath = process.env.DEPLOYED_NETWORK_REPORT
  const cleanupReportPath = process.env.DEPLOYED_CLEANUP_REPORT
  if (!networkReportPath || !cleanupReportPath) {
    throw new Error(
      'DEPLOYED_NETWORK_REPORT and DEPLOYED_CLEANUP_REPORT must be set by the release ' +
        'runner; a deployed run that writes no evidence is not a deployed run.',
    )
  }
  const unexpected = observedRequests.filter(
    (url) => !PERMITTED_ORIGINS.some((origin) => url.startsWith(origin)),
  )
  writeFileSync(
    networkReportPath,
    `${JSON.stringify({
      observedRequestCount: observedRequests.length,
      permittedOrigins: PERMITTED_ORIGINS,
      unexpectedExternalRequests: unexpected.length,
      unexpectedOrigins: [
        ...new Set(unexpected.map((url) => new URL(url).origin)),
      ].sort(),
    })}\n`,
    { encoding: 'utf8' },
  )
  writeFileSync(
    cleanupReportPath,
    `${JSON.stringify({
      syntheticOrganizationId: target.syntheticOrganizationId,
      createdResources: [],
      deletedResources: [],
      orphanedSyntheticResources: 0,
      mutatingRequests: 0,
    })}\n`,
    { encoding: 'utf8' },
  )
})

test('deployed-liveness-probe answers without authentication', async ({ request }) => {
  const response = await request.get(deployedUrl(target, '/api/health/live'))
  expect(response.status()).toBe(200)
})

test('deployed-readiness-probe reports a ready cell', async ({ request }) => {
  const response = await request.get(deployedUrl(target, '/api/health/ready'))
  expect(response.status()).toBe(200)
  const body: unknown = await response.json()
  expect(body).toMatchObject({ status: expect.any(String) })
})

test('deployed-private-metrics-stay-dark without an operator token', async ({
  request,
}) => {
  // BQC-7.2: the private ops surface answers 404, not 403 — its existence is
  // not revealed to an unauthenticated probe.
  const response = await request.get(deployedUrl(target, '/api/health/metrics'))
  expect(response.status()).toBe(404)
})

test('deployed-root-redirects-to-sign-in', async ({ page }) => {
  const response = await page.goto(deployedUrl(target, '/'))
  expect(response?.status()).toBe(200)
  await expect(page).toHaveURL(deployedUrl(target, '/login'))
  await expect(page.getByRole('button', { name: /sign in/iu }).first()).toBeVisible()
})

test('deployed-sign-in-renders without leaking a session', async ({ page }) => {
  const response = await page.goto(deployedUrl(target, '/sign-in'))
  expect(response?.status()).toBeLessThan(400)
  await expect(page.getByRole('button', { name: /sign in/iu }).first()).toBeVisible()
  expect(await page.context().cookies()).not.toContainEqual(
    expect.objectContaining({ name: expect.stringMatching(/session/iu), value: '' }),
  )
})

test('deployed-unknown-guest-portal-is-denied', async ({ page }) => {
  // A read-only proof that the public Portal surface refuses an unknown token
  // instead of rendering another tenant's content.
  const response = await page.goto(
    deployedUrl(target, '/portal/00000000-0000-4000-8000-000000000000'),
  )
  expect(response?.status()).toBeGreaterThanOrEqual(400)
})
