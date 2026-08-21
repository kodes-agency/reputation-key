import type { Page } from '@playwright/test'
import { test, expect } from '../helpers/error-detection'
import { signIn } from '../helpers/auth'
import { waitForHydration, clickWhenReady } from '../helpers/interaction'
import { requireE2eSeedState } from '../helpers/seed-state'
import { attachRequestLog } from '../helpers/request-log'
import {
  callServerFn,
  callServerFnGet,
  callServerFnExpectError,
  callServerFnGetExpectError,
  e2eRunId,
  seedGoogleConnection,
} from '../helpers/fixtures'
import { mailStubControl } from '../fixtures/mail-stub'

const seed = requireE2eSeedState()
const BASE_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const BASE_HOST = new URL(BASE_ORIGIN).host

async function expectControlledUnavailable(page: Page, feature: string) {
  await expect(page).toHaveURL(/\/unavailable/)
  expect(new URL(page.url()).searchParams.get('feature')).toBe(feature)
  await expect(page.getByText(`${feature} isn't available yet`)).toBeVisible()
}

async function expectPublicUnavailable(page: Page) {
  await expect(page.getByRole('heading', { name: 'Portal Unavailable' })).toBeVisible()
  await expect(page.getByText('Please try again later.')).toBeVisible()
}

test.describe('Critical: beta-local-1 product journeys', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ baseURL: BASE_ORIGIN })
  let governedGoalDefinitionId: string | null = null
  const activeGoalName = `E2E Active Governed Goal ${e2eRunId.slice(-8)}`

  test('P1 Portal management and opaque public URL survive reload', async ({ page }) => {
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
    const description = page.getByLabel('Description')
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

    // A portal cannot be published until it has at least one link: the guest
    // surface has nothing to lay out otherwise. `createPortal` has no
    // publicationState field, so `updatePortal` is the only route to
    // 'published' and owns the precondition (portal_has_no_links -> 409).
    const emptyPublishDenial = await callServerFnExpectError(page, {
      file: 'src/contexts/portal/server/portals.ts',
      exportName: 'updatePortal',
      data: { portalId: created.portal.id, publicationState: 'published' },
    })
    expect(emptyPublishDenial.message ?? '').toContain(
      'add at least one link before publishing this portal',
    )

    // So the journey has to build the link tree first — a category, since a
    // link belongs to one, then the link itself.
    const category = await callServerFn<{ category: { id: string } }>(page, {
      file: 'src/contexts/portal/server/portal-link-categories.ts',
      exportName: 'createLinkCategory',
      data: { portalId: created.portal.id, title: 'E2E Rotating Links' },
    })
    expect(category.category.id).toBeTruthy()

    const link = await callServerFn<{ link: { id: string } }>(page, {
      file: 'src/contexts/portal/server/portal-links.ts',
      exportName: 'createLink',
      data: {
        categoryId: category.category.id,
        portalId: created.portal.id,
        label: 'Visit rotating review destination',
        url: 'https://example.com/rotating-reviews',
      },
    })
    expect(link.link.id).toBeTruthy()

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

    const issued = await callServerFn<{ rawToken: string; version: number }>(page, {
      file: 'src/contexts/portal/server/portals.ts',
      exportName: 'issuePortalToken',
      data: { portalId: created.portal.id, printBatch: 'e2e-browser' },
    })
    expect(issued.version).toBe(1)
    const rotated = await callServerFn<{ rawToken: string; version: number }>(page, {
      file: 'src/contexts/portal/server/portals.ts',
      exportName: 'rotatePortalToken',
      data: { portalId: created.portal.id },
    })
    expect(rotated.version).toBe(2)
    expect(rotated.rawToken).not.toBe(issued.rawToken)

    await page.goto(`/properties/${seed.p1PropertyId}/portals`)
    await expect(page.getByRole('link', { name: portalName, exact: true })).toBeVisible()
    await expect(page.getByText(groupName, { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('link', { name: portalName, exact: true })).toBeVisible()

    await page.goto(`/p/${issued.rawToken}`)
    await expect(page.getByRole('heading', { name: portalName })).toBeVisible()
    await page.goto(`/p/${rotated.rawToken}`)
    await expect(page.getByRole('heading', { name: portalName })).toBeVisible()
    // The reason the precondition exists: a published portal renders a real
    // destination for guests rather than a bare title.
    await expect(
      page.getByRole('link', { name: 'Visit rotating review destination' }),
    ).toHaveAttribute(
      'href',
      `/api/public/p/${encodeURIComponent(rotated.rawToken)}/click/${link.link.id}`,
    )
  })

  test('P2 and cross-tenant P3 deny promoted routes and public tokens', async ({
    page,
  }) => {
    const log = attachRequestLog(page)
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)

    await page.goto(`/properties/${seed.p2PropertyId}/portals`)
    await expectControlledUnavailable(page, 'Portals')
    await page.goto(`/properties/${seed.p3PropertyId}/portals`)
    await expectControlledUnavailable(page, 'Portals')
    await page.goto(`/properties/${seed.p2PropertyId}/teams/${seed.teamId}`)
    await expectControlledUnavailable(page, 'Teams')
    await page.goto(`/properties/${seed.p3PropertyId}/teams/${seed.teamId}`)
    await expectControlledUnavailable(page, 'Teams')

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

    for (const [url, feature] of [
      [`/properties/${seed.p3PropertyId}/portals`, 'Portals'],
      [`/properties/${seed.p3PropertyId}/teams`, 'Teams'],
      [`/properties/${seed.p3PropertyId}/goals`, 'Goals'],
      [
        `/leaderboard?propertyId=${seed.p3PropertyId}&portalGroupId=${seed.portalGroupId}`,
        'Recognition board',
      ],
    ] as const) {
      await page.goto(url)
      await expectControlledUnavailable(page, feature)
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

  test('property suspension and organization capability kill switches stop P1 immediately', async ({
    page,
  }) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const policyFile = 'src/contexts/identity/server/policy-admin.ts'

    await callServerFn(page, {
      file: policyFile,
      exportName: 'setPropertySuspensionFn',
      data: {
        propertyId: seed.p1PropertyId,
        suspend: true,
        reason: 'E2E property containment probe',
        ticketRef: 'E2E-PS1',
      },
    })
    try {
      await page.goto(`/properties/${seed.p1PropertyId}/portals`)
      await expectControlledUnavailable(page, 'Portals')
      await page.goto(`/p/${seed.portalToken}`)
      await expectPublicUnavailable(page)
    } finally {
      await callServerFn(page, {
        file: policyFile,
        exportName: 'setPropertySuspensionFn',
        data: {
          propertyId: seed.p1PropertyId,
          suspend: false,
          reason: 'E2E property containment restored',
          ticketRef: 'E2E-PS1',
        },
      })
    }

    await callServerFn(page, {
      file: policyFile,
      exportName: 'setOrgCapabilityFn',
      data: {
        capability: 'portal.public_read',
        enabled: false,
        reason: 'E2E public Portal kill-switch probe',
      },
    })
    try {
      await page.goto(`/p/${seed.portalToken}`)
      await expectPublicUnavailable(page)
    } finally {
      await callServerFn(page, {
        file: policyFile,
        exportName: 'setOrgCapabilityFn',
        data: {
          capability: 'portal.public_read',
          enabled: true,
          reason: 'E2E public Portal kill-switch restored',
        },
      })
    }
    await page.goto(`/p/${seed.portalToken}`)
    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()
  })

  test('cross-property Portal, Team, and email resources fail closed', async ({
    page,
  }) => {
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

    const teamDenial = await callServerFnGetExpectError(page, {
      file: 'src/contexts/team/server/teams.ts',
      exportName: 'listTeams',
      data: { propertyId: seed.p2PropertyId },
    })
    expect(teamDenial.message ?? teamDenial.code ?? '').toMatch(
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

  test('manager creates a team, adds members, and durably replaces its lead', async ({
    page,
  }) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const teamName = `E2E Created Team ${e2eRunId.slice(-8)}`
    const created = await callServerFn<{ team: { id: string } }>(page, {
      file: 'src/contexts/team/server/teams.ts',
      exportName: 'createTeam',
      data: {
        propertyId: seed.p1PropertyId,
        name: teamName,
        description: 'Created through the real Team command.',
      },
    })

    await callServerFn(page, {
      file: 'src/contexts/team/server/teams.ts',
      exportName: 'addTeamMember',
      data: {
        teamId: created.team.id,
        staffParticipationId: seed.candidateAParticipationId,
      },
    })
    await callServerFn(page, {
      file: 'src/contexts/team/server/teams.ts',
      exportName: 'setTeamLead',
      data: {
        teamId: created.team.id,
        staffParticipationId: seed.candidateAParticipationId,
      },
    })
    await callServerFn(page, {
      file: 'src/contexts/team/server/teams.ts',
      exportName: 'addTeamMember',
      data: {
        teamId: created.team.id,
        staffParticipationId: seed.candidateBParticipationId,
      },
    })
    await callServerFn(page, {
      file: 'src/contexts/team/server/teams.ts',
      exportName: 'setTeamLead',
      data: {
        teamId: created.team.id,
        staffParticipationId: seed.candidateBParticipationId,
      },
    })

    await page.goto(`/properties/${seed.p1PropertyId}/teams/${created.team.id}`)
    await expect(page.getByRole('heading', { name: teamName })).toBeVisible()
    await expect(
      page.getByRole('combobox', { name: 'Active team member' }),
    ).toContainText(seed.candidateBName)
    await page.reload()
    await expect(
      page.getByRole('combobox', { name: 'Active team member' }),
    ).toContainText(seed.candidateBName)

    const denied = await callServerFnExpectError(page, {
      file: 'src/contexts/team/server/teams.ts',
      exportName: 'createTeam',
      data: {
        propertyId: seed.p2PropertyId,
        name: `Denied ${teamName}`,
      },
    })
    expect(denied.message ?? denied.code ?? '').toMatch(/error|denied|forbidden/i)
  })

  test('manager replaces the P1 team lead, reloads durable state, and restores it', async ({
    page,
  }) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    await page.goto(`/properties/${seed.p1PropertyId}/teams/${seed.teamId}`)
    await waitForHydration(page)
    await expect(
      page.getByRole('heading', { name: 'E2E Guest Services Team' }),
    ).toBeVisible()

    const leadSelect = page.getByRole('combobox', { name: 'Active team member' })
    await clickWhenReady(leadSelect)
    await clickWhenReady(page.getByRole('option', { name: seed.staffName }))
    await clickWhenReady(page.getByRole('button', { name: 'Replace lead' }))
    await expect(page.getByText('Team lead updated')).toBeVisible()

    await page.reload()
    await expect(leadSelect).toContainText(seed.staffName)

    await clickWhenReady(leadSelect)
    await clickWhenReady(page.getByRole('option', { name: seed.managerName }))
    await clickWhenReady(page.getByRole('button', { name: 'Replace lead' }))
    await expect(page.getByText('Team lead updated')).toBeVisible()
    await page.reload()
    await expect(leadSelect).toContainText(seed.managerName)
  })

  test('manager creates an active governed P1 goal while P2 direct navigation is denied', async ({
    page,
  }) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const created = await callServerFn<{ definition: { id: string; status: string } }>(
      page,
      {
        file: 'src/contexts/goal/server/governed-goals.ts',
        exportName: 'createGovernedGoal',
        data: {
          propertyId: seed.p1PropertyId,
          scope: { kind: 'portal_group', portalGroupId: seed.portalGroupId },
          name: activeGoalName,
          description: 'Active governed Goal visible to scoped Staff.',
          metricDefinitionVersionId: '11111111-1111-4111-8111-111111111101',
          measureKind: 'progress',
          targetValue: 20,
          sourcePolicy: 'first_party_workflow',
          recurrenceRule: { frequency: 'monthly', interval: 1, dayOfMonth: 1 },
        },
      },
    )
    governedGoalDefinitionId = created.definition.id
    expect(created.definition.status).toBe('active')

    await page.goto(`/properties/${seed.p1PropertyId}/goals`)
    await expect(page.getByText(activeGoalName, { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText(activeGoalName, { exact: true })).toBeVisible()

    await page.goto(`/properties/${seed.p2PropertyId}/goals`)
    await expectControlledUnavailable(page, 'Goals')
    await page.goto(`/properties/${seed.p3PropertyId}/goals/${governedGoalDefinitionId}`)
    await expectControlledUnavailable(page, 'Goals')
  })

  test('manager creates, revises, pauses, resumes, and cancels a governed P1 group Goal', async ({
    page,
  }) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const goalName = `E2E Governed Goal ${e2eRunId.slice(-8)}`
    const metricDefinitionVersionId = '11111111-1111-4111-8111-111111111101'
    const recurrenceRule = { frequency: 'monthly', interval: 1, dayOfMonth: 1 }
    const created = await callServerFn<{
      definition: { id: string; status: string }
      period: { definitionVersionId: string }
    }>(page, {
      file: 'src/contexts/goal/server/governed-goals.ts',
      exportName: 'createGovernedGoal',
      data: {
        propertyId: seed.p1PropertyId,
        scope: { kind: 'portal_group', portalGroupId: seed.portalGroupId },
        name: goalName,
        description: 'Created through the governed Goal command.',
        metricDefinitionVersionId,
        measureKind: 'progress',
        targetValue: 12,
        sourcePolicy: 'first_party_workflow',
        recurrenceRule,
      },
    })
    expect(created.definition.status).toBe('active')
    expect(created.period.definitionVersionId).toBeTruthy()

    const revised = await callServerFn<{
      version: { definitionId: string; targetValue: number }
      period: { definitionVersionId: string }
    }>(page, {
      file: 'src/contexts/goal/server/governed-goals.ts',
      exportName: 'reviseGovernedGoal',
      data: {
        propertyId: seed.p1PropertyId,
        definitionId: created.definition.id,
        metricDefinitionVersionId,
        measureKind: 'progress',
        targetValue: 15,
        sourcePolicy: 'first_party_workflow',
        recurrenceRule,
        reason: 'Exercise immutable version history.',
      },
    })
    expect(revised.version.targetValue).toBe(15)
    expect(revised.version.definitionId).toBe(created.definition.id)

    for (const status of ['paused', 'active', 'cancelled'] as const) {
      const changed = await callServerFn<{ status: string }>(page, {
        file: 'src/contexts/goal/server/governed-goals.ts',
        exportName: 'changeGovernedGoalStatus',
        data: {
          propertyId: seed.p1PropertyId,
          definitionId: created.definition.id,
          status,
          reason: `E2E transition to ${status}.`,
        },
      })
      expect(changed.status).toBe(status)
    }

    const listed = await callServerFnGet<{
      goals: ReadonlyArray<{ id: string; status: string }>
    }>(page, {
      file: 'src/contexts/goal/server/governed-goals.ts',
      exportName: 'listGovernedGoals',
      data: { propertyId: seed.p1PropertyId },
    })
    expect(listed.goals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.definition.id,
          status: 'cancelled',
        }),
      ]),
    )

    const denied = await callServerFnExpectError(page, {
      file: 'src/contexts/goal/server/governed-goals.ts',
      exportName: 'createGovernedGoal',
      data: {
        propertyId: seed.p2PropertyId,
        scope: { kind: 'property' },
        name: `Denied ${goalName}`,
        metricDefinitionVersionId,
        measureKind: 'progress',
        targetValue: 1,
        sourcePolicy: 'first_party_workflow',
        recurrenceRule,
      },
    })
    expect(denied.message ?? denied.code ?? '').toMatch(/error|denied|forbidden/i)
    const prohibitedSource = await callServerFnExpectError(page, {
      file: 'src/contexts/goal/server/governed-goals.ts',
      exportName: 'createGovernedGoal',
      data: {
        propertyId: seed.p1PropertyId,
        scope: { kind: 'portal_group', portalGroupId: seed.portalGroupId },
        name: `Prohibited ${goalName}`,
        metricDefinitionVersionId: '11111111-1111-4111-8111-111111111202',
        measureKind: 'level',
        targetValue: 4,
        sourcePolicy: 'first_party_guest_private',
        recurrenceRule,
      },
    })
    expect(prohibitedSource.message ?? prohibitedSource.code ?? '').toMatch(
      /error|invalid|denied|forbidden/i,
    )
  })

  test('Staff has read-only P1 progress and cannot open manager mutation routes', async ({
    page,
  }) => {
    await signIn(
      page,
      seed.staffEmail,
      seed.staffPassword,
      BASE_ORIGIN,
      '/settings/profile',
    )
    expect(governedGoalDefinitionId).toBeTruthy()
    const staffGoals = await callServerFnGet<{
      goals: ReadonlyArray<{ id: string; status: string }>
    }>(page, {
      file: 'src/contexts/goal/server/governed-goals.ts',
      exportName: 'listGovernedGoals',
      data: { propertyId: seed.p1PropertyId },
    })
    expect(staffGoals.goals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: governedGoalDefinitionId, status: 'active' }),
      ]),
    )
    const deniedMutation = await callServerFnExpectError(page, {
      file: 'src/contexts/goal/server/governed-goals.ts',
      exportName: 'createGovernedGoal',
      data: {
        propertyId: seed.p1PropertyId,
        scope: { kind: 'property' },
        name: 'Staff cannot create this Goal',
        metricDefinitionVersionId: '11111111-1111-4111-8111-111111111101',
        measureKind: 'progress',
        targetValue: 1,
        sourcePolicy: 'first_party_workflow',
        recurrenceRule: { frequency: 'monthly', interval: 1, dayOfMonth: 1 },
      },
    })
    expect(deniedMutation.message ?? deniedMutation.code ?? '').toMatch(
      /error|denied|forbidden|manager/i,
    )

    await page.goto(`/progress?propertyId=${seed.p1PropertyId}`)
    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible()
    await expect(page.getByText(activeGoalName, { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /new goal|create goal/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /new goal|create goal/i })).toHaveCount(
      0,
    )
    await page.reload()
    await expect(page.getByText(activeGoalName, { exact: true })).toBeVisible()

    await page.goto(`/properties/${seed.p1PropertyId}/goals/new`)
    await expect(page).not.toHaveURL(/\/goals\/new/)
    await expect(page.getByRole('heading', { name: 'New Goal' })).toHaveCount(0)

    await page.goto(`/progress?propertyId=${seed.p2PropertyId}`)
    await expectControlledUnavailable(page, 'Goals')
  })

  test('recognition activation settings and governed P1 group board persist; P2 is denied', async ({
    page,
  }) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    await page.goto(`/settings/recognition?propertyId=${seed.p1PropertyId}`)
    await expect(page.getByRole('heading', { name: 'Recognition' })).toBeVisible()
    await expect(page.getByLabel('E2E Guest Services')).toBeChecked()
    await expect(page.getByLabel('Jurisdiction')).toHaveValue('local-e2e')
    const settings = await callServerFnGet<{
      activation: {
        status: string
        selectedPortalGroupIds: readonly string[]
        employmentDecisionEligible: false
      }
    }>(page, {
      file: 'src/contexts/leaderboard/server/leaderboards.ts',
      exportName: 'getRecognitionSettings',
      data: { propertyId: seed.p1PropertyId },
    })
    expect(settings.activation).toMatchObject({
      status: 'active',
      employmentDecisionEligible: false,
    })
    expect(settings.activation.selectedPortalGroupIds).toContain(seed.portalGroupId)
    await page.reload()
    await expect(page.getByLabel('E2E Guest Services')).toBeChecked()
    await expect(page.getByLabel('Jurisdiction')).toHaveValue('local-e2e')

    const prohibitedSource = await callServerFnExpectError(page, {
      file: 'src/contexts/leaderboard/server/leaderboards.ts',
      exportName: 'activateRecognition',
      data: {
        propertyId: seed.p1PropertyId,
        policyVersion: 'beta-local-1',
        jurisdiction: 'local-e2e',
        noticeStatus: 'completed',
        consultationStatus: 'not_required',
        audience: 'property_managers_and_scoped_staff',
        selectedPortalGroupIds: [seed.portalGroupId],
        metricDefinitionVersionId: '11111111-1111-4111-8111-111111111202',
        aggregation: 'latest',
        periodKind: 'monthly',
        minimumExposure: 1,
        minimumSample: 5,
        freshnessSeconds: 2_678_400,
        minimumCompleteness: 0.9,
      },
    })
    expect(prohibitedSource.message ?? prohibitedSource.code ?? '').toMatch(
      /error|invalid|denied|forbidden/i,
    )

    const board = await callServerFnGet<{
      status: string
      employmentDecisionEligible: false
      entries: ReadonlyArray<{
        portalGroupId: string
        portalGroupLabel: string
        rank: number | null
      }>
    }>(page, {
      file: 'src/contexts/leaderboard/server/leaderboards.ts',
      exportName: 'getRecognitionBoard',
      data: {
        propertyId: seed.p1PropertyId,
        portalGroupId: seed.portalGroupId,
      },
    })
    expect(board.employmentDecisionEligible).toBe(false)
    expect(board.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          portalGroupId: seed.portalGroupId,
          portalGroupLabel: 'E2E Guest Services',
          rank: 1,
        }),
      ]),
    )
    await page.goto(
      `/leaderboard?propertyId=${seed.p1PropertyId}&portalGroupId=${seed.portalGroupId}`,
    )
    await expect(page.getByRole('heading', { name: 'Recognition board' })).toBeVisible()
    await expect(page.getByText('E2E Guest Services')).toBeVisible()

    await page.goto(
      `/leaderboard?propertyId=${seed.p2PropertyId}&portalGroupId=${seed.portalGroupId}`,
    )
    await expectControlledUnavailable(page, 'Recognition board')
    await page.goto(`/settings/recognition?propertyId=${seed.p2PropertyId}`)
    await expect(page).toHaveURL(/\/unavailable/)
    const deniedFeature = new URL(page.url()).searchParams.get('feature')
    expect(['Recognition', 'Recognition board']).toContain(deniedFeature)
    await expect(page.getByText(`${deniedFeature} isn't available yet`)).toBeVisible()
  })

  test('Staff reads its P1 group board but cannot open manager settings', async ({
    page,
  }) => {
    await signIn(
      page,
      seed.staffEmail,
      seed.staffPassword,
      BASE_ORIGIN,
      '/settings/profile',
    )

    await page.goto(
      `/leaderboard?propertyId=${seed.p1PropertyId}&portalGroupId=${seed.portalGroupId}`,
    )
    await expect(page.getByRole('heading', { name: 'Recognition board' })).toBeVisible()
    await expect(page.getByText('E2E Guest Services')).toBeVisible()
    await expect(page.getByText(seed.managerName, { exact: true })).toHaveCount(0)
    await expect(page.getByText(seed.staffName, { exact: true })).toHaveCount(0)

    await page.goto('/settings/recognition')
    await expect(page).toHaveURL(/\/settings\/profile/)
    await expect(page.getByRole('heading', { name: 'Recognition' })).toHaveCount(0)

    await page.goto('/settings/organization')
    await expect(page).toHaveURL(/\/settings\/profile/)
    await expect(page.getByRole('heading', { name: 'Organization' })).toHaveCount(0)
  })

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
    const reviewEmailSwitch = page.locator('#workflow_collaboration-email')
    await expect(reviewEmailSwitch).toBeChecked()
    await reviewEmailSwitch.click()
    await expect(page.getByText('Notification preference updated')).toBeVisible()
    await page.reload()
    await expect(reviewEmailSwitch).not.toBeChecked()
    await reviewEmailSwitch.click()
    await expect(page.getByText('Notification preference updated')).toBeVisible()
    await page.reload()
    await expect(reviewEmailSwitch).toBeChecked()
  })

  test('security and organization mutations persist and restore their baselines', async ({
    page,
  }) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN, '/settings/security')
    const temporaryPassword = `${seed.password}-changed`
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
        response.request().method() === 'POST' && response.url().includes('/_serverFn/'),
    )
    await clickWhenReady(page.getByRole('button', { name: 'Update password' }))
    await expect((await passwordRestore).ok()).toBe(true)

    await page.goto('/settings/organization')
    const organizationFields = {
      slug: await page.locator('#org-slug').inputValue(),
      contactEmail: await page.locator('#org-contact-email').inputValue(),
      billingCompanyName: await page.locator('#billing-company-name').inputValue(),
      billingAddress: await page.locator('#billing-address').inputValue(),
      billingCity: await page.locator('#billing-city').inputValue(),
      billingPostalCode: await page.locator('#billing-postal-code').inputValue(),
      billingCountry: await page.locator('#billing-country').inputValue(),
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
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /^staff$/i }).click()
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

    const extractReviewCount = async (row: {
      innerText: () => Promise<string | null>
    }) => {
      const text = (await row.innerText()) ?? ''
      const match = text.match(/(\d+)\s+reviews/i)
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
    await expect(page).toHaveURL(
      new RegExp(
        `/properties/${seed.p1PropertyId}\\?timeRange=all&performanceRange=30d$`,
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
    await expect(onePage).toHaveURL(
      new RegExp(
        `/properties/${seed.p1PropertyId}\\?timeRange=all&performanceRange=30d$`,
      ),
    )
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
