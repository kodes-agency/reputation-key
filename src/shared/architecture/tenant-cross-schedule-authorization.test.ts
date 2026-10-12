// Capability-gated tenant-cross schedules decide each tenant they act for.
//
// A tenant-cross schedule firing names no Organization, so the delayed policy
// admits it as an enumeration boundary BEFORE the capability check
// (system-execution-policy.ts): the kill switch, a suspension and the allowlist
// are never asked about the firing itself. The stop therefore applies only if
// the handler asks current policy about every concrete Organization and
// Property it then acts for. The Review Analysis backlog drain did not, and
// kept sending a stopped Organization's queued reviews to the provider.
//
// Nothing structural told the next schedule to do it, so this suite is
// exhaustive over the entry-point catalogue: a new capability-gated
// tenant-cross schedule fails here until it names how its candidates are
// decided, and a schedule that claims a scope authorizer must be given one for
// its own action where the worker registers it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  isCoreCapability,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import {
  ENTRY_POINT_CATALOGUE,
  type EntryPointRow,
} from '#/shared/governance/entry-point-catalogue'
import {
  createScheduledScopeAuthorizer,
  gateJob,
} from '#/shared/jobs/delayed-execution-gate'

const ROOT = process.cwd()
const ORGANIZATION = 'tenant-cross-schedule-organization'
const OTHER_ORGANIZATION = 'tenant-cross-schedule-other-organization'
const PROPERTY = '7c5c0000-0000-4000-8000-000000000001'

/** How a schedule's candidates meet current policy. */
type CandidateDecision =
  /**
   * The worker hands the job a scope authorizer for the schedule's own action,
   * and the handler asks it about each Organization (and Property) before it
   * acts for them.
   */
  | Readonly<{ kind: 'scope_authorizer' }>
  /**
   * The schedule does no governed work for a tenant itself. What it raises or
   * recovers runs through `entryPoint`, which the dispatch gate decides with
   * the candidate's own scope under the same capability.
   */
  | Readonly<{ kind: 'scoped_entry_point'; entryPoint: string; reason: string }>
  /**
   * A known gap, not a decision: the schedule acts for every tenant and asks
   * nothing. Recorded so it is visible and cannot be joined by another; it
   * leaves this list by gaining a scope authorizer.
   */
  | Readonly<{ kind: 'undecided'; gap: string }>

const SCOPE_AUTHORIZER: CandidateDecision = { kind: 'scope_authorizer' }

const CANDIDATE_DECISIONS: Readonly<Record<string, CandidateDecision>> = {
  'portal-approved-destination-revalidation-recurring': SCOPE_AUTHORIZER,
  'ai-review-analysis-backlog-drain-recurring': SCOPE_AUTHORIZER,
  'reconcile-gbp-notification-subscriptions-recurring': SCOPE_AUTHORIZER,
  'goal-program.maintain-recurring': SCOPE_AUTHORIZER,
  'digest-notification-recurring': SCOPE_AUTHORIZER,
  'schedule-property-ai-trends-recurring': {
    kind: 'scoped_entry_point',
    entryPoint: 'ai.property-trend-consumers',
    reason:
      'Writes one identifier-only schedule row and generation request per due Property and calls no provider. The request is consumed, and the trend generated, only through Property-scoped entry points gated on ai.detect_trends.',
  },
  'google-import-claim-reaper-recurring': {
    kind: 'scoped_entry_point',
    entryPoint: 'import-gbp-property-item-v2',
    reason:
      'Recovery only: releases or closes import item claims whose worker died, through the store compare-and-set helpers. It starts no import and calls no provider; a released item is imported only by the Organization-scoped item job.',
  },
  'release-response-target-reminders-recurring': {
    kind: 'undecided',
    gap: 'Marks due Response Target reminders delivered and commits their identifier-only fact for every Organization, so a switched-off inbox.use or a suspended Organization still gets the in-app reminder. Nothing leaves RepKey from it: the reminder email is decided per Organization by the email jobs.',
  },
}

const GATED_TENANT_CROSS_SCHEDULES: ReadonlyArray<EntryPointRow> =
  ENTRY_POINT_CATALOGUE.filter(
    (row) =>
      row.kind === 'schedule' &&
      row.capability !== 'none' &&
      row.resourceScope === 'tenant_cross',
  )

const rowsDecidedBy = (kind: CandidateDecision['kind']) =>
  GATED_TENANT_CROSS_SCHEDULES.filter(
    (row) => CANDIDATE_DECISIONS[row.name]?.kind === kind,
  ).map((row) => [row.name, row] as const)

/** The BullMQ job a schedule row fires (delayed-execution-gate strips the suffix). */
const jobNameOf = (row: EntryPointRow) => row.name.replace(/-recurring$/u, '')

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

function installPolicy(env: Readonly<Record<string, string>>): void {
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore(env))
  initDelayedExecutionPolicy(
    createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
  )
}

describe('capability-gated tenant-cross schedules decide each candidate', () => {
  afterEach(() => {
    resetDelayedExecutionPolicy()
    resetCapabilityPolicyStore()
  })

  it('names how every capability-gated tenant-cross schedule decides its candidates', () => {
    expect(GATED_TENANT_CROSS_SCHEDULES.length).toBeGreaterThan(0)
    expect(Object.keys(CANDIDATE_DECISIONS).sort()).toEqual(
      GATED_TENANT_CROSS_SCHEDULES.map((row) => row.name).sort(),
    )
  })

  it.each(rowsDecidedBy('scope_authorizer'))(
    '%s is admitted while its capability is switched off, so only its handler can stop',
    async (_name, row) => {
      installPolicy({ BETA_ALLOWLIST_ORGS: '*', BETA_CAPABILITIES_OFF: row.capability })

      const firing = await gateJob(
        jobNameOf(row),
        {},
        `schedule:${jobNameOf(row)}`,
        'schedule',
      )

      expect({ kind: firing.kind, reason: firing.decision.reason }).toEqual({
        kind: 'allow',
        reason: 'allowed',
      })
    },
  )

  it.each(rowsDecidedBy('scope_authorizer'))(
    '%s is given a scope authorizer for its own action where the worker registers it',
    (_name, row) => {
      const bootstrap = readFileSync(join(ROOT, 'src/bootstrap.ts'), 'utf8')

      expect(
        new RegExp(
          `createScheduledScopeAuthorizer\\(\\s*'${escapeRegExp(row.action)}',?\\s*\\)`,
          'u',
        ).test(bootstrap),
        `${jobNameOf(row)} fires tenant-cross under ${row.capability}: bootstrap must hand its handler createScheduledScopeAuthorizer('${row.action}'), and the handler must ask it about each Organization and Property before acting for them`,
      ).toBe(true)
    },
  )

  it.each(rowsDecidedBy('scope_authorizer'))(
    "%s's scope authorizer refuses a stopped Organization and allows the others",
    async (_name, row) => {
      if (row.capability === 'none') throw new Error(`${row.name} is ungated`)
      const authorize = createScheduledScopeAuthorizer(row.action)
      const verdicts: Record<string, boolean> = {}

      installPolicy({ BETA_ALLOWLIST_ORGS: '*' })
      verdicts.open = await authorize(ORGANIZATION, PROPERTY)
      installPolicy({ BETA_ALLOWLIST_ORGS: '*', BETA_CAPABILITIES_OFF: row.capability })
      verdicts.capabilityOff = await authorize(ORGANIZATION, PROPERTY)
      installPolicy({ BETA_ALLOWLIST_ORGS: '*', BETA_CAPABILITIES_OFF: 'all' })
      verdicts.everythingOff = await authorize(ORGANIZATION, PROPERTY)
      installPolicy({ BETA_ALLOWLIST_ORGS: '*', BETA_SUSPENDED_ORGS: ORGANIZATION })
      verdicts.suspended = await authorize(ORGANIZATION, PROPERTY)
      verdicts.otherWhileSuspended = await authorize(OTHER_ORGANIZATION, PROPERTY)
      installPolicy({ BETA_ALLOWLIST_ORGS: OTHER_ORGANIZATION })
      verdicts.notAllowlisted = await authorize(ORGANIZATION, PROPERTY)

      expect(verdicts).toEqual({
        open: true,
        capabilityOff: false,
        everythingOff: false,
        suspended: false,
        otherWhileSuspended: true,
        // A core capability needs no allowlist entry; a controlled one does.
        notAllowlisted: isCoreCapability(row.capability),
      })
    },
  )

  it.each(rowsDecidedBy('scoped_entry_point'))(
    '%s leaves the governed work to a scoped entry point under the same capability',
    (name, row) => {
      const decision = CANDIDATE_DECISIONS[name]
      if (decision?.kind !== 'scoped_entry_point') {
        throw new Error(`${name} does not name a scoped entry point`)
      }
      const entryPoint = ENTRY_POINT_CATALOGUE.find(
        (candidate) =>
          candidate.name === decision.entryPoint &&
          (candidate.kind === 'job' || candidate.kind === 'consumer'),
      )

      expect(decision.reason.length).toBeGreaterThanOrEqual(80)
      expect(
        entryPoint && {
          capability: entryPoint.capability,
          scoped:
            entryPoint.resourceScope === 'organization' ||
            entryPoint.resourceScope === 'property',
        },
        `${name} names ${decision.entryPoint}, which must be a job or consumer the gate decides per Organization under ${row.capability}`,
      ).toEqual({ capability: row.capability, scoped: true })
    },
  )

  it('records no undecided schedule beyond the one known gap', () => {
    // This list may only shrink. A new schedule that acts for tenants gets a
    // scope authorizer; it is never added here.
    expect(rowsDecidedBy('undecided').map(([name]) => name)).toEqual([
      'release-response-target-reminders-recurring',
    ])
  })
})
