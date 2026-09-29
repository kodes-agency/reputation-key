import { describe, expect, it, vi } from 'vitest'
import { organizationId, type OrganizationId } from '#/shared/domain/ids'
import type { GbpSubscribeBackfillReport } from './gbp-subscribe-backfill'
import { createGbpNotificationReconciliation } from './reconcile-gbp-notification-subscriptions'

const ORG_A = organizationId('org-reconcile-a')
const ORG_B = organizationId('org-reconcile-b')
const ORG_C = organizationId('org-reconcile-c')
const NOW_MS = 1_790_000_000_000
const NO_ACCOUNTS = { subscribed: 0, alreadySubscribed: 0, failed: 0, failureCodes: {} }

const report = (
  organization: OrganizationId,
  overrides: Partial<GbpSubscribeBackfillReport> = {},
): GbpSubscribeBackfillReport => ({
  action: 'subscribe',
  organizationId: organization,
  connections: 1,
  candidates: 1,
  counts: { subscribed: 1 },
  accounts: { ...NO_ACCOUNTS, subscribed: 1 },
  connectionOutcomes: [],
  ...overrides,
})

const failedReport = (organization: OrganizationId, code: string) =>
  report(organization, {
    counts: { provider_failed: 1 },
    accounts: { ...NO_ACCOUNTS, failed: 1, failureCodes: { [code]: 1 } },
  })

const setup = (
  input: Readonly<{
    topicConfigured?: boolean
    organizations?: ReadonlyArray<OrganizationId>
    reports?: Readonly<Record<string, GbpSubscribeBackfillReport | Error>>
    clock?: () => number
  }> = {},
) => {
  const listOrganizations = vi.fn(async () => input.organizations ?? [ORG_A])
  const apply = vi.fn(async (organization: OrganizationId) => {
    const planned = input.reports?.[organization]
    if (planned instanceof Error) throw planned
    return planned ?? report(organization)
  })
  const reconcile = createGbpNotificationReconciliation({
    topicConfigured: input.topicConfigured ?? true,
    listOrganizations,
    backfill: { apply },
    nowMs: input.clock ?? (() => NOW_MS),
  })
  const run = (authorizeOrganization: (org: OrganizationId) => Promise<boolean>) =>
    reconcile({ authorizeOrganization, deadlineAtMs: NOW_MS + 60_000 })
  return { run, listOrganizations, apply }
}

const allowAll = async () => true

describe('createGbpNotificationReconciliation', () => {
  it('does nothing at all when no Pub/Sub topic is configured', async () => {
    const { run, listOrganizations, apply } = setup({ topicConfigured: false })
    const authorizeOrganization = vi.fn(allowAll)

    await expect(run(authorizeOrganization)).resolves.toEqual({ status: 'topic_unset' })
    expect(listOrganizations).not.toHaveBeenCalled()
    expect(authorizeOrganization).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('backfills every organization current policy allows, one at a time', async () => {
    const { run, apply } = setup({ organizations: [ORG_A, ORG_B, ORG_C] })
    const authorizeOrganization = vi.fn(
      async (organization: OrganizationId) => organization !== ORG_B,
    )

    const summary = await run(authorizeOrganization)

    expect(authorizeOrganization.mock.calls).toEqual([[ORG_A], [ORG_B], [ORG_C]])
    expect(apply.mock.calls).toEqual([[ORG_A], [ORG_C]])
    expect(summary).toMatchObject({
      status: 'reconciled',
      organizations: 3,
      organizationsDenied: 1,
      retry: false,
    })
  })

  it('adds up connections, outcomes and accounts across organizations', async () => {
    const { run } = setup({
      organizations: [ORG_A, ORG_B],
      reports: {
        [ORG_A]: report(ORG_A, {
          connections: 3,
          candidates: 2,
          counts: {
            already_subscribed: 1,
            skipped_inactive: 1,
            authorization_unavailable: 1,
          },
          accounts: { ...NO_ACCOUNTS, alreadySubscribed: 2 },
        }),
        [ORG_B]: failedReport(ORG_B, 'provider_403'),
      },
    })

    await expect(run(allowAll)).resolves.toEqual({
      status: 'reconciled',
      organizations: 2,
      organizationsDenied: 0,
      organizationsFailed: 0,
      organizationsDeferred: 0,
      connections: 4,
      candidates: 3,
      connectionOutcomes: {
        already_subscribed: 1,
        skipped_inactive: 1,
        authorization_unavailable: 1,
        provider_failed: 1,
      },
      unsettledConnections: 2,
      accounts: {
        ...NO_ACCOUNTS,
        alreadySubscribed: 2,
        failed: 1,
        failureCodes: { provider_403: 1 },
      },
      retry: false,
    })
  })

  it.each(['connection_inactive', 'account_unresolved', 'skipped_inactive'] as const)(
    'does not count a %s connection as needing attention',
    async (outcome) => {
      const { run } = setup({
        reports: {
          [ORG_A]: report(ORG_A, { counts: { [outcome]: 1 }, accounts: NO_ACCOUNTS }),
        },
      })

      await expect(run(allowAll)).resolves.toMatchObject({ unsettledConnections: 0 })
    },
  )

  it.each([
    'coordination_unavailable',
    // A permit fenced at start: a race with a binding or credential change, or
    // a worker running before the web deploy applied the permit-start
    // migration. Either clears within minutes.
    'authorization_changed',
    'quota_exhausted',
    'in_flight_exhausted',
    'transport_error',
    'provider_429',
    'provider_503',
  ])('asks for a retry when an account failed transiently (%s)', async (code) => {
    const { run } = setup({ reports: { [ORG_A]: failedReport(ORG_A, code) } })

    await expect(run(allowAll)).resolves.toMatchObject({ retry: true })
  })

  it.each(['provider_403', 'authorization_denied', 'parse_error'])(
    'leaves a lasting refusal (%s) to the next day',
    async (code) => {
      const { run } = setup({ reports: { [ORG_A]: failedReport(ORG_A, code) } })

      await expect(run(allowAll)).resolves.toMatchObject({ retry: false })
    },
  )

  it('keeps going past an organization whose backfill failed, and asks for a retry', async () => {
    const { run, apply } = setup({
      organizations: [ORG_A, ORG_B],
      reports: { [ORG_A]: new Error('database unavailable') },
    })

    await expect(run(allowAll)).resolves.toMatchObject({
      organizationsFailed: 1,
      connections: 1,
      accounts: { ...NO_ACCOUNTS, subscribed: 1 },
      retry: true,
    })
    expect(apply.mock.calls).toEqual([[ORG_A], [ORG_B]])
  })

  it('starts no organization after its deadline and reports the rest as deferred', async () => {
    let nowMs = NOW_MS
    const { run, apply } = setup({
      organizations: [ORG_A, ORG_B, ORG_C],
      clock: () => nowMs,
    })
    apply.mockImplementationOnce(async (organization) => {
      nowMs += 120_000
      return report(organization)
    })

    await expect(run(allowAll)).resolves.toMatchObject({
      organizations: 3,
      organizationsDeferred: 2,
      retry: false,
    })
    expect(apply.mock.calls).toEqual([[ORG_A]])
  })

  it('reports an empty run when nobody holds an active connection', async () => {
    const { run, apply } = setup({ organizations: [] })

    await expect(run(allowAll)).resolves.toEqual({
      status: 'reconciled',
      organizations: 0,
      organizationsDenied: 0,
      organizationsFailed: 0,
      organizationsDeferred: 0,
      connections: 0,
      candidates: 0,
      connectionOutcomes: {},
      unsettledConnections: 0,
      accounts: NO_ACCOUNTS,
      retry: false,
    })
    expect(apply).not.toHaveBeenCalled()
  })

  it('lets a policy outage fail the run so the queue retries it', async () => {
    const { run, apply } = setup({ organizations: [ORG_A] })
    const outage = new Error('policy unavailable')

    await expect(
      run(async () => {
        throw outage
      }),
    ).rejects.toBe(outage)
    expect(apply).not.toHaveBeenCalled()
  })
})
