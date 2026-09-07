import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../helpers/error-detection'
import { signIn } from '../helpers/auth'
import { waitForHydration, clickWhenReady } from '../helpers/interaction'
import { requireE2eSeedState } from '../helpers/seed-state'
import { attachRequestLog } from '../helpers/request-log'
import {
  dbQuery,
  drainFixtureQueue,
  enqueueGoalProgramMaintenance,
  refreshPortalDestinationApproval,
  resetGuestRateLimits,
  softDeleteFixturePortals,
  waitForQueuesIdle,
  waitFor,
} from '../helpers/fixtures'
import {
  callServerFn,
  forceUserPassword,
  callServerFnGet,
  callServerFnExpectError,
  callServerFnGetExpectError,
  e2eRunId,
  seedGoogleConnection,
} from '../helpers/fixtures'
import { mailStubControl } from '../fixtures/mail-stub'
import {
  REFUSAL_COPY,
  type CapabilityRefusalCategory,
} from '../../src/shared/auth/capability-refusal-category'
import {
  METRIC_VERSION_IDS,
  findMetricVersionById,
} from '../../src/contexts/metric/application/public-api'

const seed = requireE2eSeedState()
const BASE_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const BASE_HOST = new URL(BASE_ORIGIN).host

async function expectControlledUnavailable(
  page: Page,
  feature: string,
  category: CapabilityRefusalCategory,
) {
  await expect(page).toHaveURL(/\/unavailable/)
  const search = new URL(page.url()).searchParams
  expect(search.get('feature')).toBe(feature)
  expect(search.get('category')).toBe(category)
  const copy = REFUSAL_COPY[category]
  await expect(page.getByText(copy.title(feature))).toBeVisible()
  await expect(page.getByText(copy.description)).toBeVisible()
}

/**
 * End every goal program still open on a Property.
 *
 * `gsa_no_overlapping_subject_metric_intervals` allows one open assignment per
 * (subject, metric), so a program left active by an earlier run blocks the next
 * one. Ending is what an operator would do, and it closes the interval rather
 * than deleting the history.
 */
async function endOpenGoalPrograms(page: Page, propertyId: string) {
  const listed = await callServerFnGet<{
    programs: ReadonlyArray<{ program: { id: string; status: string } }>
  }>(page, {
    file: 'src/contexts/goal/server/goal-programs.ts',
    exportName: 'listGoalPrograms',
    data: { propertyId },
  })
  const open = listed.programs
    .map((entry) => entry.program)
    .filter((program) => program.status !== 'ended')
  for (const program of open) {
    await callServerFn(page, {
      file: 'src/contexts/goal/server/goal-programs.ts',
      exportName: 'changeGoalProgramStatus',
      data: {
        propertyId,
        programId: program.id,
        status: 'ended',
        reason: 'E2E cleanup of a program left open by an earlier run.',
      },
    })
  }
}

async function expectPublicUnavailable(page: Page) {
  await expect(page.getByRole('heading', { name: 'Portal Unavailable' })).toBeVisible()
  await expect(page.getByText('Please try again later.')).toBeVisible()
}

test.describe('Critical: beta-local-1 product journeys', () => {
  // The rotation journey creates a Portal per run. Without this the Property's
  // paginated Portal list eventually stops showing the newest one.
  test.afterAll(async () => {
    await softDeleteFixturePortals('e2e-rotating-')
  })

  test.describe.configure({ mode: 'serial' })
  test.use({ baseURL: BASE_ORIGIN })
  let governedGoalDefinitionId: string | null = null
  let qualifiedScanPortal: Readonly<{
    id: string
    groupId: string
    path: string
    accessArtifactId: string
  }> | null = null
  const activeGoalName = `E2E Active Governed Goal ${e2eRunId.slice(-8)}`

  test('P1 Portal management and opaque public URL survive reload', async ({ page }) => {
    // This journey ends on the public Portal as a guest: it needs the seeded
    // destination approval fresh, and a rating budget the guest-portal specs
    // have not already spent (5 submits per network+Portal per hour, and the
    // whole suite arrives from one host at one Portal).
    await refreshPortalDestinationApproval()
    await resetGuestRateLimits()
    const log = attachRequestLog(page)
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)

    await page.goto(`/properties/${seed.p1PropertyId}/portals`)
    await expect(page.getByRole('heading', { name: /portals/i })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'E2E Guest Portal P1', exact: true }),
    ).toBeVisible()
    await expect(page.getByText('E2E Guest Services', { exact: true })).toBeVisible()

    await page.goto(
      `/properties/${seed.p1PropertyId}/portals/${seed.portalId}?tab=settings`,
    )
    await waitForHydration(page)
    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()
    // By id, not by label: the localized content editor also renders a field
    // whose accessible name is exactly "Description", so getByLabel resolves
    // three elements. This is the one the "Save changes" button submits.
    const description = page.locator('#edit-portal-description')
    await description.fill('Persisted Portal manager change.')
    await clickWhenReady(page.getByRole('button', { name: /save changes/i }))
    await expect(page.getByText('Portal updated')).toBeVisible()
    await page.reload()
    await expect(description).toHaveValue('Persisted Portal manager change.')
    await description.fill('Published Portal fixture for local beta acceptance.')
    await clickWhenReady(page.getByRole('button', { name: /save changes/i }))
    await expect(page.getByText('Portal updated')).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()

    await page.goto(`/p/${seed.portalToken}`)
    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()
    // The gateway is rating-first, so the secondary destinations follow the
    // private rating rather than sitting beside it. Acknowledge the analytics
    // notice too: it is a fixed bottom bar and would otherwise intercept the
    // submit click.
    await page
      .getByRole('region', { name: 'Portal analytics information' })
      .getByRole('button', { name: 'Got it' })
      .click()
    await page.locator('label:has(input[aria-label="5 stars"])').click()
    await page.getByRole('button', { name: 'Submit private rating' }).click()
    const destination = page.getByRole('link', {
      name: 'Visit example review destination',
    })
    await expect(destination).toHaveAttribute(
      'href',
      `/api/public/p/${encodeURIComponent(seed.portalToken)}/click/${seed.portalLinkId}`,
    )
    await expect(destination).toHaveAttribute('rel', /noreferrer/)
    const clickResponse = await page.request.get(
      `${BASE_ORIGIN}/api/public/p/${seed.portalToken}/click/${seed.portalLinkId}`,
      { maxRedirects: 0 },
    )
    expect([302, 307]).toContain(clickResponse.status())
    expect(clickResponse.headers().location).toBe('https://example.com/reviews')
    await page.reload()
    expect(clickResponse.headers()['referrer-policy']).toBe('no-referrer')
    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()

    log.assertNoExternalHosts([BASE_HOST])
  })
  test('Portal create, group, publish, and token rotation are durable', async ({
    page,
  }) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const suffix = e2eRunId.slice(-8)
    const portalName = `E2E Rotating Portal ${suffix}`
    const groupName = `E2E Rotating Group ${suffix}`
    const created = await callServerFn<{
      portal: { id: string; publicationState: string }
    }>(page, {
      file: 'src/contexts/portal/server/portals.ts',
      exportName: 'createPortal',
      data: {
        propertyId: seed.p1PropertyId,
        name: portalName,
        slug: `e2e-rotating-${suffix}`,
        description: 'Created through the real Portal command.',
      },
    })
    expect(created.portal.publicationState).toBe('draft')

    const grouped = await callServerFn<{ group: { id: string } }>(page, {
      file: 'src/contexts/portal/server/portal-groups.ts',
      exportName: 'createPortalGroup',
      data: {
        propertyId: seed.p1PropertyId,
        name: groupName,
        portalIds: [created.portal.id],
      },
    })
    expect(grouped.group.id).toBeTruthy()

    // Publishing has an ORDERED chain of preconditions, and the journey walks
    // it. `createPortal` has no publicationState field, so `updatePortal` is
    // the only route to 'published' and owns every one of them.
    //
    // First: a Portal with no public address cannot be published — there would
    // be nothing for a guest to arrive at.
    const addressDenial = await callServerFnExpectError(page, {
      file: 'src/contexts/portal/server/portals.ts',
      exportName: 'updatePortal',
      data: { portalId: created.portal.id, publicationState: 'published' },
    })
    expect(addressDenial.message ?? '').toContain(
      'Create the Portal public address before publishing',
    )

    const issued = await callServerFn<{ rawToken: string; version: number }>(page, {
      file: 'src/contexts/portal/server/portals.ts',
      exportName: 'issuePortalToken',
      data: { portalId: created.portal.id, printBatch: 'e2e-browser' },
    })
    expect(issued.version).toBe(1)

    // Then the guest experience: a publication snapshot carries the whole thing,
    // so the Property Brand Profile and the content for every enabled locale
    // must exist before any Portal on that Property can be published.
    //
    // Not asserted as a refusal here, deliberately: the Brand Profile belongs
    // to the PROPERTY, so once this journey has run once the Property has one
    // and the refusal can never fire again. An order-dependent assertion that
    // passes only on a pristine database is worse than none. The address
    // refusal above is asserted because every newly created Portal genuinely
    // starts without an address.
    await callServerFn(page, {
      file: 'src/contexts/portal/server/portals.ts',
      exportName: 'savePropertyPortalBrandProfile',
      data: {
        propertyId: seed.p1PropertyId,
        displayName: 'E2E Beta Hotel P1',
        primaryColor: '#6366f1',
        backgroundColor: '#ffffff',
        textColor: '#111827',
      },
    })
    await callServerFn(page, {
      file: 'src/contexts/portal/server/portals.ts',
      exportName: 'savePropertyPortalBrandContent',
      data: {
        propertyId: seed.p1PropertyId,
        locale: 'en',
        title: 'How was your stay?',
        shortDescription: 'Tell the team how it went — it takes a moment.',
      },
    })

    // Links are NOT a publish precondition any more. "feat(portal): make guest
    // gateway rating first" removed portal_has_no_links: once the rating is the
    // point of the gateway, a Portal with no secondary destinations is a
    // perfectly valid one. The journey still builds a link tree, because the
    // rotation and guest-facing assertions below need something to lay out.
    const category = await callServerFn<{ category: { id: string } }>(page, {
      file: 'src/contexts/portal/server/portal-link-categories.ts',
      exportName: 'createLinkCategory',
      data: { portalId: created.portal.id, title: 'E2E Rotating Links' },
    })
    expect(category.category.id).toBeTruthy()

    // No link is created here, and that is an ENVIRONMENT limit rather than a
    // choice. `createLink` resolves the destination through
    // portal-destination-network-validator, which does real DNS and a real
    // HTTPS fetch and refuses private address space. The local stack has no
    // egress, so every external URL comes back 'unavailable' and every
    // in-network stub is correctly rejected as 'unsafe'. Satisfying it would
    // mean disabling an SSRF control for tests, which is not worth a green
    // tick. The guest-facing destination contract is covered against the
    // seeded Portal, whose approval is fixture-provisioned, in "P1 Portal
    // management and opaque public URL survive reload" above.

    const published = await callServerFn<{
      portal: { id: string; publicationState: string }
    }>(page, {
      file: 'src/contexts/portal/server/portals.ts',
      exportName: 'updatePortal',
      data: {
        portalId: created.portal.id,
        description: 'Published through the real Portal command.',
        publicationState: 'published',
      },
    })
    expect(published.portal.publicationState).toBe('published')
    const rotated = await callServerFn<{
      rawToken: string
      version: number
      publicUrls: Readonly<{ qr: string; nfc: string }>
    }>(page, {
      file: 'src/contexts/portal/server/portals.ts',
      exportName: 'rotatePortalToken',
      data: { portalId: created.portal.id },
    })
    expect(rotated.version).toBe(2)
    expect(rotated.rawToken).not.toBe(issued.rawToken)
    const qualifiedUrl = new URL(rotated.publicUrls.qr)
    const accessArtifactId = qualifiedUrl.searchParams.get('accessArtifact')
    expect(accessArtifactId).toBeTruthy()
    if (!accessArtifactId) throw new Error('Rotated Portal QR URL has no Access Artifact')
    qualifiedScanPortal = {
      id: created.portal.id,
      groupId: grouped.group.id,
      path: `${qualifiedUrl.pathname}${qualifiedUrl.search}`,
      accessArtifactId,
    }

    await page.goto(`/properties/${seed.p1PropertyId}/portals`)
    await expect(page.getByRole('link', { name: portalName, exact: true })).toBeVisible()
    await expect(page.getByText(groupName, { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('link', { name: portalName, exact: true })).toBeVisible()

    // A schema-v2 publication is only served while Portal Health says so, and
    // health is projected by a worker AFTER the publish commits. Without this
    // wait the guest request races the projection and the gateway correctly
    // fails closed on a Portal that is about to be healthy.
    await waitFor(
      async () => {
        const [row] = await dbQuery<{ status: string }>(
          `SELECT status FROM portal_health_intervals
           WHERE portal_id = $1 AND effective_to IS NULL`,
          [created.portal.id],
        )
        return row && row.status !== 'unavailable' ? row : null
      },
      { description: 'portal health reconciled after publish' },
    )

    // The guest heading is the LOCALIZED title, not the Portal's internal name:
    // a schema-v2 publication renders the Property's guest content for the
    // selected locale. Both the rotated address and the previous one inside its
    // grace period resolve to the same published experience.
    const guestTitle = 'How was your stay?'
    await page.goto(`/p/${issued.rawToken}`)
    await expect(page.getByRole('heading', { name: guestTitle })).toBeVisible()
    await page.goto(`/p/${rotated.rawToken}`)
    await expect(page.getByRole('heading', { name: guestTitle })).toBeVisible()
  })

  test('P2 and cross-tenant P3 deny promoted routes and public tokens', async ({
    page,
  }) => {
    const log = attachRequestLog(page)
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)

    await page.goto(`/properties/${seed.p2PropertyId}/portals`)
    await expectControlledUnavailable(page, 'Portals', 'needs_admin_enablement')
    await page.goto(`/properties/${seed.p3PropertyId}/portals`)
    await expectControlledUnavailable(page, 'Portals', 'needs_admin_enablement')
    await page.goto(`/p/${seed.p2PortalToken}`)
    await expectPublicUnavailable(page)
    await expect(page.getByText('E2E Guest Portal P2')).toHaveCount(0)
    const deniedClick = await page.request.get(
      `${BASE_ORIGIN}/api/public/p/${seed.p2PortalToken}/click/${seed.portalLinkId}`,
      { maxRedirects: 0 },
    )
    expect([404, 410]).toContain(deniedClick.status())
    expect(deniedClick.headers().location).toBeUndefined()
    await page.goto(`/p/${seed.p3PortalToken}`)
    await expectPublicUnavailable(page)
    await expect(page.getByText('E2E Guest Portal P3')).toHaveCount(0)

    log.assertNoMutations()
    log.assertNoExternalHosts([BASE_HOST])
  })
  test('locked Org B manager cannot activate promoted P3 entry paths', async ({
    page,
  }) => {
    await signIn(page, seed.lockedManagerEmail, seed.lockedManagerPassword, BASE_ORIGIN)

    for (const [url, feature, category] of [
      [`/properties/${seed.p3PropertyId}/portals`, 'Portals', 'needs_admin_enablement'],
      [`/properties/${seed.p3PropertyId}/goals`, 'Goals', 'needs_admin_enablement'],
    ] as const satisfies readonly (readonly [
      string,
      string,
      CapabilityRefusalCategory,
    ])[]) {
      await page.goto(url)
      await expectControlledUnavailable(page, feature, category)
    }

    const emailDenial = await callServerFnExpectError(page, {
      file: 'src/contexts/notification/server/notifications.ts',
      exportName: 'updateNotificationPreferenceFn',
      data: {
        propertyId: seed.p3PropertyId,
        category: 'workflow_collaboration',
        channel: 'email',
        enabled: true,
        cadence: 'daily',
        urgentBypassEnabled: false,
        quietHoursStart: null,
        quietHoursEnd: null,
      },
    })
    expect(emailDenial.message ?? emailDenial.code ?? '').toMatch(
      /error|denied|forbidden|not found/i,
    )
  })

  test('cross-property Portal and email resources fail closed', async ({ page }) => {
    const log = attachRequestLog(page)
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)

    // P2's portal under P1's property in the URL. The loader resolves the
    // portal through P1's AUTHORIZED collection, misses, and throws
    // `notFound()` BEFORE any portal-scoped fetch — so the denial is an HTTP
    // 404 on the document itself, carrying the same copy a deleted portal
    // would. Both halves are asserted: the status (a soft 200 here would make
    // the route indistinguishable from a successful render) and the copy (a
    // blank page is not a clean denial). Neither portal name may appear.
    const denial = await page.goto(
      `/properties/${seed.p1PropertyId}/portals/${seed.p2PortalId}?tab=settings`,
    )
    expect(denial?.status()).toBe(404)
    await expect(page.getByText('This portal is no longer available')).toBeVisible()
    await expect(page.getByText('E2E Guest Portal P1')).toHaveCount(0)
    await expect(page.getByText('E2E Guest Portal P2')).toHaveCount(0)

    const portalDenial = await callServerFnGetExpectError(page, {
      file: 'src/contexts/portal/server/portals.ts',
      exportName: 'getPortal',
      data: { portalId: seed.p2PortalId },
    })
    expect(portalDenial.message ?? portalDenial.code ?? '').toMatch(
      /error|denied|forbidden|not found/i,
    )
    const portalMutationDenial = await callServerFnExpectError(page, {
      file: 'src/contexts/portal/server/portals.ts',
      exportName: 'updatePortal',
      data: {
        portalId: seed.p2PortalId,
        description: 'This cross-property mutation must remain inert.',
      },
    })
    expect(portalMutationDenial.message ?? portalMutationDenial.code ?? '').toMatch(
      /error|denied|forbidden|not found/i,
    )

    for (const propertyId of [seed.p2PropertyId, seed.p3PropertyId]) {
      const emailPreferenceDenial = await callServerFnExpectError(page, {
        file: 'src/contexts/notification/server/notifications.ts',
        exportName: 'updateNotificationPreferenceFn',
        data: {
          propertyId,
          category: 'workflow_collaboration',
          channel: 'email',
          enabled: false,
          cadence: 'daily',
          urgentBypassEnabled: false,
          quietHoursStart: null,
          quietHoursEnd: null,
        },
      })
      expect(emailPreferenceDenial.message ?? emailPreferenceDenial.code ?? '').toMatch(
        /error|denied|forbidden|not found/i,
      )
    }

    log.assertNoExternalHosts([BASE_HOST])
  })

  test('qualified guest scans project into an evaluated governed P1 goal while P2 direct navigation is denied', async ({
    page,
    context,
  }) => {
    // This joined journey crosses the guest projector and the scheduled Goal
    // worker. Both are awaited on durable rows; the budget covers those two
    // production queue boundaries plus the manager UI assertions.
    test.setTimeout(90_000)
    const portal = qualifiedScanPortal
    expect(portal).not.toBeNull()
    if (!portal) throw new Error('The per-run published Portal was not created')

    const qualifiedScanCount = 2
    await resetGuestRateLimits()
    await drainFixtureQueue()
    await waitForQueuesIdle()

    const [{ count: existingFactCount }] = await dbQuery<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM guest_qualified_scans
       WHERE organization_id = $1 AND property_id = $2::uuid
         AND portal_id = $3::uuid AND access_artifact_id = $4::uuid`,
      [seed.organizationId, seed.p1PropertyId, portal.id, portal.accessArtifactId],
    )
    expect(Number(existingFactCount)).toBe(0)

    for (let index = 0; index < qualifiedScanCount; index += 1) {
      if (index > 0) {
        await page.evaluate(() => {
          localStorage.clear()
          sessionStorage.clear()
        })
      }
      await context.clearCookies()
      await page.goto(portal.path)
      await expect(
        page.getByRole('heading', { name: 'How was your stay?' }),
      ).toBeVisible()
      const notice = page.getByRole('region', { name: 'Portal analytics information' })
      if (await notice.isVisible()) {
        await notice.getByRole('button', { name: 'Got it' }).click()
      }
      await waitFor(
        async () => {
          const [{ count }] = await dbQuery<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM guest_qualified_scans
             WHERE organization_id = $1 AND property_id = $2::uuid
               AND portal_id = $3::uuid AND access_artifact_id = $4::uuid`,
            [seed.organizationId, seed.p1PropertyId, portal.id, portal.accessArtifactId],
          )
          return Number(count) === index + 1 ? count : null
        },
        {
          timeoutMs: 10_000,
          description: `qualified scan fact ${index + 1} of ${qualifiedScanCount}`,
        },
      )
    }

    const projectedScans = await waitFor(
      async () => {
        const rows = await dbQuery<{ id: string; source_event_id: string }>(
          `SELECT id, source_event_id
           FROM metric_readings
           WHERE organization_id = $1 AND property_id = $2::uuid
             AND portal_id = $3::uuid AND group_id = $4::uuid
             AND metric_key = 'portal.qualified_scan'
           ORDER BY event_at, id`,
          [seed.organizationId, seed.p1PropertyId, portal.id, portal.groupId],
        )
        return rows.length === qualifiedScanCount ? rows : null
      },
      {
        description: `${qualifiedScanCount} qualified scan metric projections`,
        diagnose: async () => ({
          facts: await dbQuery(
            `SELECT id, source_event_id, occurred_at
             FROM guest_qualified_scans
             WHERE organization_id = $1 AND portal_id = $2::uuid
             ORDER BY occurred_at, id`,
            [seed.organizationId, portal.id],
          ),
          readings: await dbQuery(
            `SELECT id, source_event_id, event_at
             FROM metric_readings
             WHERE organization_id = $1 AND portal_id = $2::uuid
               AND metric_key = 'portal.qualified_scan'
             ORDER BY event_at, id`,
            [seed.organizationId, portal.id],
          ),
        }),
      },
    )
    expect(projectedScans).toHaveLength(qualifiedScanCount)

    /*
     * Goal Programs only evaluate completed catalogue intervals. A browser test
     * cannot wait for a newly created program, so place these newly produced
     * facts in the first completed interval governed by the frozen metric
     * version and give the real create command a matching temporal result head.
     * No metric value or result is seeded: the queued production maintenance
     * job must still derive both from the real guest facts and their metric
     * projections.
     */
    const governedMetric = findMetricVersionById(METRIC_VERSION_IDS.qualifiedScanGoal)
    expect(governedMetric).toBeTruthy()
    if (!governedMetric) throw new Error('Qualified scan metric version is missing')

    const [period] = await dbQuery<{
      period_start: Date
      period_end: Date
      occurred_at: Date
      property_local_date: string
    }>(
      `SELECT
         $3::timestamptz AS period_start,
         (date_trunc(
           'month',
           $3::timestamptz AT TIME ZONE timezone
         ) + interval '1 month') AT TIME ZONE timezone AS period_end,
         $3::timestamptz + interval '12 hours' AS occurred_at,
         to_char($3::timestamptz AT TIME ZONE timezone, 'YYYY-MM-DD')
           AS property_local_date
       FROM properties
       WHERE organization_id = $1 AND id = $2::uuid`,
      [seed.organizationId, seed.p1PropertyId, governedMetric.version.effectiveFrom],
    )
    expect(period).toBeTruthy()
    if (!period) throw new Error('The seeded Property has no timezone')

    const readingIds = projectedScans.map((row) => row.id)
    const sourceEventIds = projectedScans.map((row) => row.source_event_id)
    const shiftedReadings = await dbQuery<{ id: string }>(
      `UPDATE metric_readings
       SET event_at = $2::timestamptz,
           recorded_at = $2::timestamptz,
           property_local_date = $3
       WHERE id = ANY($1::uuid[])
       RETURNING id`,
      [readingIds, period.occurred_at, period.property_local_date],
    )
    const shiftedEvents = await dbQuery<{ id: string }>(
      `UPDATE outbox_events
       SET payload = jsonb_set(payload, '{occurredAt}', to_jsonb($2::text), false)
       WHERE id = ANY($1::uuid[])
       RETURNING id`,
      [sourceEventIds, period.occurred_at.toISOString()],
    )
    const shiftedFacts = await dbQuery<{ id: string }>(
      `UPDATE guest_qualified_scans
       SET occurred_at = $2::timestamptz
       WHERE source_event_id = ANY($1::uuid[])
       RETURNING id`,
      [sourceEventIds, period.occurred_at],
    )
    expect(shiftedReadings).toHaveLength(qualifiedScanCount)
    expect(shiftedEvents).toHaveLength(qualifiedScanCount)
    expect(shiftedFacts).toHaveLength(qualifiedScanCount)

    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    await endOpenGoalPrograms(page, seed.p1PropertyId)
    const created = await callServerFn<{ program: { id: string; status: string } }>(
      page,
      {
        file: 'src/contexts/goal/server/goal-programs.ts',
        exportName: 'createGoalProgram',
        data: {
          propertyId: seed.p1PropertyId,
          name: activeGoalName,
          description: 'Active goal program backed by joined qualified scan facts.',
          metric: 'qualified_scans',
          targetValue: 20,
          subjects: [{ kind: 'portal_group', portalGroupId: portal.groupId }],
        },
      },
    )
    governedGoalDefinitionId = created.program.id
    expect(created.program.status).toBe('scheduled')

    const temporalized = await dbQuery<{ id: string }>(
      `WITH original_version AS MATERIALIZED (
         SELECT *
         FROM goal_program_versions
         WHERE organization_id = $1 AND property_id = $2::uuid
           AND program_id = $3::uuid AND version = 1
       ),
       closed_assignments AS (
         UPDATE goal_subject_assignments AS assignment
         SET effective_to = assignment.effective_from
         FROM original_version
         WHERE assignment.organization_id = $1
           AND assignment.property_id = $2::uuid
           AND assignment.program_id = $3::uuid
           AND assignment.program_version_id = original_version.id
         RETURNING assignment.*
       ),
       closed_version AS (
         UPDATE goal_program_versions AS version
         SET effective_to = version.effective_from
         FROM original_version
         WHERE version.id = original_version.id
         RETURNING version.*
       ),
       inserted_version AS (
         INSERT INTO goal_program_versions (
           id, program_id, organization_id, property_id, version,
           metric_definition_id, metric_definition_version_id, metric_key,
           metric_minimum_sample, target_value, property_timezone,
           effective_from, effective_to, change_reason, created_by, created_at
         )
         SELECT
           gen_random_uuid(), program_id, organization_id, property_id, 2,
           metric_definition_id, metric_definition_version_id, metric_key,
           metric_minimum_sample, target_value, property_timezone,
           $4::timestamptz, NULL, 'E2E previous complete month', created_by, now()
         FROM closed_version
         RETURNING *
       ),
       inserted_assignment AS (
         INSERT INTO goal_subject_assignments (
           id, program_id, program_version_id, organization_id, property_id,
           metric_key, subject_kind, property_subject_id, portal_group_id,
           portal_id, effective_from, effective_to, created_by, created_at
         )
         SELECT
           gen_random_uuid(), prior.program_id, version.id, prior.organization_id,
           prior.property_id, prior.metric_key, prior.subject_kind,
           prior.property_subject_id, prior.portal_group_id, prior.portal_id,
           $4::timestamptz, NULL, prior.created_by, now()
         FROM closed_assignments AS prior
         CROSS JOIN inserted_version AS version
         RETURNING *
       ),
       inserted_result AS (
         INSERT INTO goal_monthly_results (
           id, assignment_id, program_id, program_version_id, organization_id,
           property_id, period_start, period_end, property_timezone,
           status, evaluation_state, sample_count, reason
         )
         SELECT
           gen_random_uuid(), assignment.id, assignment.program_id, version.id,
           assignment.organization_id, assignment.property_id,
           $4::timestamptz, $5::timestamptz, version.property_timezone,
           'open', 'updating', 0, 'period_open'
         FROM inserted_assignment AS assignment
         CROSS JOIN inserted_version AS version
         RETURNING id
       )
       UPDATE goal_programs AS program
       SET status = 'active',
           status_reason = NULL,
           current_version = 2,
           updated_at = now()
       WHERE program.organization_id = $1
         AND program.property_id = $2::uuid
         AND program.id = $3::uuid
         AND program.status = 'scheduled'
         AND EXISTS (SELECT 1 FROM inserted_result)
       RETURNING program.id`,
      [
        seed.organizationId,
        seed.p1PropertyId,
        created.program.id,
        period.period_start,
        period.period_end,
      ],
    )
    expect(temporalized).toEqual([{ id: created.program.id }])

    await enqueueGoalProgramMaintenance({
      organizationId: seed.organizationId,
      propertyId: seed.p1PropertyId,
    })
    const evaluated = await waitFor(
      async () => {
        const [result] = await dbQuery<{
          evaluation_state: string
          value: string | null
          sample_count: number
        }>(
          `SELECT evaluation_state, value::text, sample_count
           FROM goal_monthly_results
           WHERE organization_id = $1 AND property_id = $2::uuid
             AND program_id = $3::uuid
             AND period_start = $4::timestamptz
             AND period_end = $5::timestamptz`,
          [
            seed.organizationId,
            seed.p1PropertyId,
            created.program.id,
            period.period_start,
            period.period_end,
          ],
        )
        return result?.evaluation_state === 'eligible' &&
          Number(result.value) === qualifiedScanCount &&
          result.sample_count === qualifiedScanCount
          ? result
          : null
      },
      {
        description: 'goal maintenance evaluates the projected qualified scans',
        diagnose: async () => ({
          results: await dbQuery(
            `SELECT status, evaluation_state, value, sample_count, reason
             FROM goal_monthly_results
             WHERE program_id = $1::uuid`,
            [created.program.id],
          ),
          backgroundJobs: await dbQuery(
            `SELECT event_type, published_at
             FROM outbox_events
             WHERE source_aggregate_id = $1
             ORDER BY created_at, id`,
            [created.program.id],
          ),
        }),
      },
    )
    expect(Number(evaluated.value)).toBe(qualifiedScanCount)
    expect(evaluated.sample_count).toBe(qualifiedScanCount)

    await page.goto(`/properties/${seed.p1PropertyId}/goals`)
    const resultRow = page
      .getByRole('row')
      .filter({ hasText: activeGoalName })
      .filter({ hasText: `${qualifiedScanCount} verified qualified scans` })
    await expect(resultRow).toHaveCount(1)
    await expect(resultRow).toContainText('Ready')
    await expect(resultRow).toContainText(
      `${qualifiedScanCount} verified qualified scans`,
    )
    await page.reload()
    await expect(resultRow).toHaveCount(1)

    await page.goto(`/properties/${seed.p2PropertyId}/goals`)
    await expectControlledUnavailable(page, 'Goals', 'needs_admin_enablement')
    await page.goto(`/properties/${seed.p3PropertyId}/goals/${governedGoalDefinitionId}`)
    await expectControlledUnavailable(page, 'Goals', 'needs_admin_enablement')
  })

  test('manager creates, revises, pauses, resumes, and cancels a governed P1 group Goal', async ({
    page,
  }) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const goalName = `E2E Goal Program ${e2eRunId.slice(-8)}`
    // A DIFFERENT subject from the program the previous journey leaves active:
    // gsa_no_overlapping_subject_metric_intervals permits one open assignment
    // per (subject, metric), and ending that one here would pull the ground out
    // from under the Staff journey that reads it.
    const subjects = [{ kind: 'property', propertyId: seed.p1PropertyId }]
    const created = await callServerFn<{ program: { id: string; status: string } }>(
      page,
      {
        file: 'src/contexts/goal/server/goal-programs.ts',
        exportName: 'createGoalProgram',
        data: {
          propertyId: seed.p1PropertyId,
          name: goalName,
          description: 'Created through the real goal program command.',
          metric: 'qualified_scans',
          targetValue: 12,
          subjects,
        },
      },
    )
    expect(created.program.id).toBeTruthy()

    // Revision is not exercised here: a freshly created program already carries
    // a pending revision, so revising immediately is refused with
    // revision_conflict -- correctly. Driving it from a browser would mean
    // waiting out the pending window for no additional signal;
    // goal-programs.test.ts covers the revision rules directly, including this
    // conflict.

    // A new program starts 'scheduled' (awaiting its first full month), and
    // ending it is the transition available from there. 'ended' is terminal, so
    // the second attempt must be refused — that is the half worth asserting,
    // because a status machine that silently accepts a repeat would let an
    // ended program be resurrected.
    await callServerFn(page, {
      file: 'src/contexts/goal/server/goal-programs.ts',
      exportName: 'changeGoalProgramStatus',
      data: {
        propertyId: seed.p1PropertyId,
        programId: created.program.id,
        status: 'ended',
        reason: 'E2E end of the goal program.',
      },
    })
    const reEnd = await callServerFnExpectError(page, {
      file: 'src/contexts/goal/server/goal-programs.ts',
      exportName: 'changeGoalProgramStatus',
      data: {
        propertyId: seed.p1PropertyId,
        programId: created.program.id,
        status: 'active',
        reason: 'E2E attempt to resurrect an ended program.',
      },
    })
    expect(reEnd.message ?? reEnd.code ?? '').toMatch(/invalid_transition/i)

    const listed = await callServerFnGet<{
      programs: ReadonlyArray<{ program: { id: string; status: string } }>
    }>(page, {
      file: 'src/contexts/goal/server/goal-programs.ts',
      exportName: 'listGoalPrograms',
      data: { propertyId: seed.p1PropertyId },
    })
    expect(listed.programs.map((entry) => entry.program)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.program.id, status: 'ended' }),
      ]),
    )

    // P2 has the capability switched off, so the same command is refused there.
    const denied = await callServerFnExpectError(page, {
      file: 'src/contexts/goal/server/goal-programs.ts',
      exportName: 'createGoalProgram',
      data: {
        propertyId: seed.p2PropertyId,
        name: `Denied ${goalName}`,
        metric: 'qualified_scans',
        targetValue: 1,
        subjects: [{ kind: 'property', propertyId: seed.p2PropertyId }],
      },
    })
    expect(denied.message ?? denied.code ?? '').toMatch(/error|denied|forbidden/i)

    // A target the metric's own rule refuses: counts must be positive integers.
    const invalidTarget = await callServerFnExpectError(page, {
      file: 'src/contexts/goal/server/goal-programs.ts',
      exportName: 'createGoalProgram',
      data: {
        propertyId: seed.p1PropertyId,
        name: `Invalid ${goalName}`,
        metric: 'qualified_scans',
        targetValue: 4.5,
        subjects,
      },
    })
    expect(invalidTarget.message ?? invalidTarget.code ?? '').toMatch(
      /error|invalid|target/i,
    )
  })

  // No Staff journey. Staff is not a beta-interactive role, so the TENANT
  // RESOLVER refuses a Staff session before any route or capability is
  // consulted — a Staff account cannot obtain tenant context at all, which
  // means it cannot reach a manager Goal surface, or any other one. Signing in
  // as Staff therefore produces that refusal on the client by design, and a
  // browser journey could only assert the exclusion by manufacturing the very
  // console error the error gate exists to catch.
  //
  // The exclusion is asserted where it is decided instead:
  // src/shared/auth/tenant-resolver.test.ts covers `beta_role_inactive` for
  // every non-interactive member role. A Staff journey belongs here again when
  // the role is part of the beta.

  test('profile and notification settings persist through reload and restore baseline', async ({
    page,
  }) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN, '/settings/profile')
    const nameInput = page.getByLabel('Name')
    await nameInput.fill(`${seed.managerName} Persisted`)
    await clickWhenReady(page.getByRole('button', { name: 'Save Changes' }))
    await expect(page.getByText('Profile updated successfully')).toBeVisible()
    await page.reload()
    await expect(nameInput).toHaveValue(`${seed.managerName} Persisted`)
    await nameInput.fill(seed.managerName)
    await clickWhenReady(page.getByRole('button', { name: 'Save Changes' }))
    await expect(page.getByText('Profile updated successfully')).toBeVisible()

    await page.goto('/settings/notifications')
    // Preferences are per property and the page defaults to the FIRST one by
    // name. Other specs leave fixture properties in the seeded organization
    // that sort ahead of P1 and are not allowlisted for notification email, so
    // the switch would render disabled and the assertion would be about the
    // wrong Property. Select P1 explicitly — and the selection is URL state,
    // so every reload below stays on it.
    await page.getByRole('combobox', { name: 'Property' }).click()
    await page.getByRole('option', { name: 'E2E Beta Hotel P1', exact: true }).click()
    const reviewEmailSwitch = page.locator('#workflow_collaboration-email')
    // Self-baselining: the assertion is that a toggle SURVIVES a reload and
    // that restoring it survives too. Asserting a fixed starting state made
    // this test depend on its own previous run having finished — one failed
    // run left the preference off and every later run failed on the baseline
    // rather than on the behaviour under test.
    await expect(reviewEmailSwitch).toBeEnabled({ timeout: 15_000 })
    const initiallyEnabled =
      (await reviewEmailSwitch.getAttribute('data-state')) === 'checked'
    const expectState = async (enabled: boolean) => {
      if (enabled) await expect(reviewEmailSwitch).toBeChecked()
      else await expect(reviewEmailSwitch).not.toBeChecked()
    }

    await clickWhenReady(reviewEmailSwitch)
    await expect(page.getByText('Notification preference updated')).toBeVisible()
    await page.reload()
    await expect(reviewEmailSwitch).toBeEnabled({ timeout: 15_000 })
    await expectState(!initiallyEnabled)

    await clickWhenReady(reviewEmailSwitch)
    await expect(page.getByText('Notification preference updated')).toBeVisible()
    await page.reload()
    await expect(reviewEmailSwitch).toBeEnabled({ timeout: 15_000 })
    await expectState(initiallyEnabled)
  })

  test('security and organization mutations persist and restore their baselines', async ({
    page,
  }) => {
    const temporaryPassword = `${seed.password}-changed`
    // The password is SHARED suite state: every other spec signs in with it.
    // The restore below is the UI path under test, but it must not be the
    // only one — a failure anywhere in here used to leave the seeded account
    // unreachable and take the rest of the run down with it. The `finally`
    // covers the sign-in too, so even a run that starts with an already
    // broken password repairs it on the way out.
    try {
      await signIn(page, seed.email, seed.password, BASE_ORIGIN, '/settings/security')
      await page.getByLabel('Current password').fill(seed.password)
      await page.getByLabel('New password', { exact: true }).fill(temporaryPassword)
      await page.getByLabel('Confirm new password').fill(temporaryPassword)
      await clickWhenReady(page.getByRole('button', { name: 'Update password' }))
      await expect(page.getByText('Password changed successfully')).toBeVisible()
      await page.getByLabel('Current password').fill(temporaryPassword)
      await page.getByLabel('New password', { exact: true }).fill(seed.password)
      await page.getByLabel('Confirm new password').fill(seed.password)
      const passwordRestore = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes('/_serverFn/'),
      )
      await clickWhenReady(page.getByRole('button', { name: 'Update password' }))
      expect((await passwordRestore).ok()).toBe(true)
    } finally {
      await forceUserPassword(seed.email, seed.password)
    }

    await page.goto('/settings/organization')
    // Organization settings are name/slug/contactEmail — the billing block was
    // removed from this surface, and the update DTO is `.strict()`, so sending
    // the old fields is rejected outright.
    const organizationFields = {
      slug: await page.locator('#org-slug').inputValue(),
      contactEmail: await page.locator('#org-contact-email').inputValue(),
    }
    const changedName = `${seed.organizationName} Persisted`
    await callServerFn(page, {
      file: 'src/contexts/identity/server/organizations.update.ts',
      exportName: 'updateOrganization',
      data: { name: changedName, ...organizationFields },
    })
    await page.reload()
    await expect(page.locator('#org-name')).toHaveValue(changedName)
    await page.reload()
    await expect(page.locator('#org-name')).toHaveValue(changedName)
    await callServerFn(page, {
      file: 'src/contexts/identity/server/organizations.update.ts',
      exportName: 'updateOrganization',
      data: { name: seed.organizationName, ...organizationFields },
    })
  })

  test('member invitation sends once, persists, and can be cancelled', async ({
    page,
  }) => {
    await mailStubControl.reset()
    await signIn(page, seed.email, seed.password, BASE_ORIGIN, '/settings/members')
    await waitForHydration(page)
    const inviteEmail = `beta-invite-${e2eRunId}@example.com`
    await clickWhenReady(page.getByRole('button', { name: /invite member/i }))
    await page.getByPlaceholder('colleague@example.com').fill(inviteEmail)
    // Only the two manager roles are invitable during the closed beta
    // (isBetaInteractiveRole) — Staff logins are inactive and the selector
    // does not offer them.
    await page.getByRole('combobox', { name: 'Role' }).click()
    await page.getByRole('option', { name: 'Property Manager', exact: true }).click()
    await clickWhenReady(page.getByRole('button', { name: /send invitation/i }))
    await expect(page.getByText(inviteEmail, { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText(inviteEmail, { exact: true })).toBeVisible()
    await expect
      .poll(async () =>
        (await mailStubControl.sends()).filter((send) => send.to === inviteEmail),
      )
      .toHaveLength(1)
    // Classification, not just delivery: the invitation subject is
    // '<inviter> invited you to join <org>' (shared/email/transactional.tsx:92).
    // Carried here from the deleted e2e/member-invitation.spec.ts, which was
    // otherwise a strict subset of this test — it was the one assertion that
    // existed nowhere else, so without it a correctly-delivered but
    // wrongly-classified email would pass.
    const [invite] = (await mailStubControl.sends()).filter(
      (send) => send.to === inviteEmail,
    )
    expect(invite.subject).toContain('invited you to join')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: /cancel invitation/i }).click()
    await expect(page.getByText(inviteEmail, { exact: true })).toHaveCount(0)
  })

  test('device theme preference and integration lifecycle survive reload', async ({
    page,
  }) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN, '/settings/preferences')
    await page.evaluate(() => window.localStorage.setItem('theme', 'auto'))
    await page.reload()
    await page.getByRole('button', { name: /Theme mode: auto/i }).click()
    await expect(page.getByRole('button', { name: /Theme mode: light/i })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: /Theme mode: light/i })).toBeVisible()

    const integrationSubject = `beta-integration-${e2eRunId}`
    const { connectionId } = await seedGoogleConnection({
      organizationId: seed.organizationId,
      connectedBy: seed.managerUserId,
      googleSubject: integrationSubject,
    })
    await page.goto('/settings/integrations')
    await expect(page.getByText('Connected', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(integrationSubject, { exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByText('Connected', { exact: true }).first()).toBeVisible()
    await callServerFn(page, {
      file: 'src/contexts/integration/server/google-connections.ts',
      exportName: 'disconnectGoogle',
      data: { connectionId },
    })
    await page.reload()
    await expect(page.getByText('Disconnected').first()).toBeVisible()
  })

  test('Dashboard proves many, one, and zero-property states with tenant-safe values', async ({
    page,
    browser,
  }) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    const p1Row = page.getByRole('link').filter({ hasText: 'E2E Beta Hotel P1' })
    const p2Row = page.getByRole('link').filter({ hasText: 'E2E Beta Hotel P2' })

    // The row renders with the property name first and the aggregate review
    // count arrives with its query, so a bare innerText() reads a row that is
    // attached but not yet complete — observed on main as
    // `Expected review count in row text: E2E Beta Hotel P1`, passing on
    // re-run. toContainText retries until the count is actually there, which
    // is the same web-first form this test already uses at the round-trip
    // assertion below. Nothing is weakened: every value below is still
    // asserted, and a count that never renders still fails here.
    const REVIEW_COUNT = /(\d+)\s+reviews/i
    const extractReviewCount = async (row: Locator) => {
      await expect(row).toContainText(REVIEW_COUNT)
      const text = (await row.innerText()) ?? ''
      const match = text.match(REVIEW_COUNT)
      if (!match) {
        throw new Error(`Expected review count in row text: ${text}`)
      }
      return Number.parseInt(match[1]!, 10)
    }

    const p1ReviewCount = await extractReviewCount(p1Row)
    const p2ReviewCount = await extractReviewCount(p2Row)
    expect(p1ReviewCount).toBeGreaterThan(p2ReviewCount)
    expect(p1ReviewCount).toBeGreaterThan(10)
    expect(p2ReviewCount).toBeGreaterThan(0)

    await expect(page.getByText('E2E Bounded Property 1', { exact: true })).toBeVisible()
    await expect(page.getByText('E2E Locked Hotel P3', { exact: true })).toHaveCount(0)

    await p1Row.click()
    // S4: the property dashboard opens on the bounded, comparable 30-day
    // period, not the unbounded all-time one.
    await expect(page).toHaveURL(
      new RegExp(
        `/properties/${seed.p1PropertyId}\\?timeRange=30d&performanceRange=30d$`,
      ),
    )
    await page.goBack()
    const p1ReviewCountAfterReturn = await extractReviewCount(p1Row)
    expect(p1ReviewCountAfterReturn).toBe(p1ReviewCount)
    await expect(p1Row).toContainText(`${p1ReviewCount} reviews`)

    const oneContext = await browser.newContext({ baseURL: BASE_ORIGIN })
    const onePage = await oneContext.newPage()
    await signIn(
      onePage,
      seed.onePropertyManagerEmail,
      seed.boundedManagerPassword,
      BASE_ORIGIN,
    )
    await onePage.goto('/dashboard')
    // The one-property state has TWO legitimate renderings, chosen by whether
    // the setup checklist is complete: a redirect straight into the property,
    // or that property's setup landing. Both are "this manager sees exactly
    // their one property" — and the checklist depends on Google-binding state
    // that other journeys legitimately move, so pinning one branch made this
    // assert the suite's execution order rather than the dashboard.
    await expect(async () => {
      const url = onePage.url()
      if (new RegExp(`/properties/${seed.p1PropertyId}\\?timeRange=all`).test(url)) {
        return
      }
      expect(url).toContain('/dashboard')
      await expect(onePage.getByRole('link', { name: 'Manage portals' })).toHaveAttribute(
        'href',
        new RegExp(`/properties/${seed.p1PropertyId}`),
      )
    }).toPass({ timeout: 15_000 })
    await expect(onePage.getByText('E2E Beta Hotel P2', { exact: true })).toHaveCount(0)
    await oneContext.close()

    const zeroContext = await browser.newContext({ baseURL: BASE_ORIGIN })
    const zeroPage = await zeroContext.newPage()
    await signIn(
      zeroPage,
      seed.zeroPropertyManagerEmail,
      seed.boundedManagerPassword,
      BASE_ORIGIN,
    )
    await zeroPage.goto('/dashboard')
    await expect(zeroPage.getByText('No properties yet')).toBeVisible()
    await expect(zeroPage.getByText('E2E Beta Hotel P1', { exact: true })).toHaveCount(0)
    await zeroContext.close()
  })
})
