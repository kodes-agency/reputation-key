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
// exhaustive over the scheduled job families, read the way the gate reads a
// firing: a new family whose firing is admitted that way fails here until it
// names how its candidates are decided, and a schedule that claims a scope
// authorizer must be given one for its own action where the worker registers
// it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  type Capability,
} from '#/shared/auth/beta-capabilities'
import {
  capabilityForSystemAction,
  createDelayedExecutionPolicy,
  getDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import {
  ENTRY_POINT_CATALOGUE,
  type EntryPointRow,
} from '#/shared/governance/entry-point-catalogue'
import {
  JOB_FAMILY_ROWS,
  type JobFamilyRow,
} from '#/shared/governance/event-job-catalogue'
import {
  createScheduledScopeAuthorizer,
  gateJob,
  TENANT_CROSS_ORG,
} from '#/shared/jobs/delayed-execution-gate'

const ROOT = process.cwd()
const ORGANIZATION = 'tenant-cross-schedule-organization'
const OTHER_ORGANIZATION = 'tenant-cross-schedule-other-organization'
const PROPERTY = '7c5c0000-0000-4000-8000-000000000001'

/** A scheduled job family whose firing is admitted before its capability is asked. */
type GatedTenantCrossSchedule = Readonly<{
  /** The BullMQ job the scheduler fires. */
  jobName: string
  /** The catalogue row the gate resolves for that firing. */
  row: EntryPointRow
  /** The capability the policy holds the row's action to. */
  capability: Capability
}>

type ScheduledFamily = Pick<JobFamilyRow, 'jobName' | 'schedule'>

/**
 * The guarded population, read the way the gate reads a firing and not from
 * the catalogue's schedule rows. What is scheduled is the job family
 * (operational-catalogue builds the scheduler plan from it). For its firing the
 * gate resolves the schedule row and falls back to the job row
 * (delayed-execution-gate rowForJob), and the policy holds the row's action to
 * the strictest capability any row of that action declares
 * (capabilityForSystemAction). A family with no schedule row, or with an
 * ungated one beside a gated job row, is admitted like the rest.
 */
function gatedTenantCrossSchedules(
  families: ReadonlyArray<ScheduledFamily>,
  catalogue: ReadonlyArray<EntryPointRow>,
): ReadonlyArray<GatedTenantCrossSchedule> {
  return families.flatMap(({ jobName, schedule }) => {
    if (schedule === 'none') return []
    const row =
      catalogue.find(
        (candidate) =>
          candidate.kind === 'schedule' &&
          candidate.name.replace(/-recurring$/u, '') === jobName,
      ) ??
      catalogue.find(
        (candidate) => candidate.kind === 'job' && candidate.name === jobName,
      )
    if (row?.resourceScope !== 'tenant_cross') return []
    const capability = capabilityForSystemAction(row.action)
    return capability === 'none' ? [] : [{ jobName, row, capability }]
  })
}

/** How a schedule's candidates meet current policy. */
type CandidateDecision =
  /**
   * The worker hands the job a scope authorizer for the schedule's own action,
   * and the handler asks it about each Organization (and Property) before it
   * acts for them. `offAllowlist` is its answer for an Organization that is not
   * on the allowlist: only a core capability is allowed there.
   */
  | Readonly<{ kind: 'scope_authorizer'; offAllowlist: 'refused' | 'allowed' }>
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

const scopeAuthorizer = (offAllowlist: 'refused' | 'allowed'): CandidateDecision => ({
  kind: 'scope_authorizer',
  offAllowlist,
})

/** Keyed by the BullMQ job the scheduler fires. */
const CANDIDATE_DECISIONS: Readonly<Record<string, CandidateDecision>> = {
  'portal-approved-destination-revalidation': scopeAuthorizer('refused'),
  'ai-review-analysis-backlog-drain': scopeAuthorizer('refused'),
  // property.connect_gbp is core: suspension and the kill switch stop it, the
  // allowlist does not.
  'reconcile-gbp-notification-subscriptions': scopeAuthorizer('allowed'),
  'goal-program.maintain': scopeAuthorizer('refused'),
  'digest-notification': scopeAuthorizer('refused'),
  'schedule-property-ai-trends': {
    kind: 'scoped_entry_point',
    entryPoint: 'ai.property-trend-consumers',
    reason:
      'Writes one identifier-only schedule row and generation request per due Property and calls no provider. The request is consumed, and the trend generated, only through Property-scoped entry points gated on ai.detect_trends.',
  },
  'google-import-claim-reaper': {
    kind: 'scoped_entry_point',
    entryPoint: 'import-gbp-property-item-v2',
    reason:
      'Recovery only: releases or closes import item claims whose worker died, through the store compare-and-set helpers. It starts no import and calls no provider; a released item is imported only by the Organization-scoped item job.',
  },
  'release-response-target-reminders': {
    kind: 'undecided',
    gap: 'Marks due Response Target reminders delivered and commits their identifier-only fact for every Organization, so a switched-off inbox.use or a suspended Organization still gets the in-app reminder. Nothing leaves RepKey from it: the reminder email is decided per Organization by the email jobs.',
  },
}

const SCHEDULED_FAMILIES = JOB_FAMILY_ROWS.filter((family) => family.schedule !== 'none')

const GATED_TENANT_CROSS_SCHEDULES = gatedTenantCrossSchedules(
  JOB_FAMILY_ROWS,
  ENTRY_POINT_CATALOGUE,
)

const schedulesDecidedBy = (kind: CandidateDecision['kind']) =>
  GATED_TENANT_CROSS_SCHEDULES.filter(
    (schedule) => CANDIDATE_DECISIONS[schedule.jobName]?.kind === kind,
  ).map((schedule) => [schedule.jobName, schedule] as const)

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

function installPolicy(env: Readonly<Record<string, string>>): void {
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore(env))
  initDelayedExecutionPolicy(
    createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
  )
}

// A family the catalogue does not hold yet, under an action the catalogue
// already holds to a capability (or to none).
const NEXT_FAMILY = 'next-tenant-sweep'
const NEXT_SCHEDULED: ScheduledFamily = { jobName: NEXT_FAMILY, schedule: 'every:60000' }
const GATED_ACTION = 'system:ai.review_analysis_backlog_drain'
const UNGATED_ACTION = 'system:retention.sweep'

function nextEntryPoint(
  kind: 'job' | 'schedule',
  overrides: Partial<EntryPointRow> = {},
): EntryPointRow {
  return {
    kind,
    name: kind === 'schedule' ? `${NEXT_FAMILY}-recurring` : NEXT_FAMILY,
    action: GATED_ACTION,
    capability: 'ai.analyze',
    resourceScope: 'tenant_cross',
    externalEffect: false,
    ...overrides,
  }
}

const NEXT_JOB_ROW = nextEntryPoint('job')
const NEXT_UNGATED_SCHEDULE_ROW = nextEntryPoint('schedule', { capability: 'none' })

describe('capability-gated tenant-cross schedules decide each candidate', () => {
  afterEach(() => {
    resetDelayedExecutionPolicy()
    resetCapabilityPolicyStore()
  })

  // The gate needs neither a schedule row nor a capability on it: a firing
  // falls back to the job row (delayed-execution-gate rowForJob), and the
  // policy takes the capability by action, strictest row wins
  // (capabilityForSystemAction). A guard that read only gated schedule rows
  // would never see either family below.
  it.each([
    ['has only a job row, which the gate falls back to', [NEXT_JOB_ROW], NEXT_JOB_ROW],
    [
      'has an ungated schedule row beside its gated job row',
      [NEXT_JOB_ROW, NEXT_UNGATED_SCHEDULE_ROW],
      NEXT_UNGATED_SCHEDULE_ROW,
    ],
  ])(
    'covers a scheduled family that %s',
    async (_shape, catalogue, rowTheGateResolves) => {
      installPolicy({ BETA_ALLOWLIST_ORGS: '*', BETA_CAPABILITIES_OFF: 'ai.analyze' })

      const firing = await getDelayedExecutionPolicy().decide({
        principal: { kind: 'system', id: `schedule:${NEXT_FAMILY}` },
        action: rowTheGateResolves.action,
        resourceScope: rowTheGateResolves.resourceScope,
        organizationId: TENANT_CROSS_ORG,
        executionKind: 'schedule',
        now: new Date(),
      })

      // Admitted although its capability is switched off, so it must be covered.
      expect({ allowed: firing.allowed, reason: firing.reason }).toEqual({
        allowed: true,
        reason: 'allowed',
      })
      expect(gatedTenantCrossSchedules([NEXT_SCHEDULED], catalogue)).toEqual([
        { jobName: NEXT_FAMILY, row: rowTheGateResolves, capability: 'ai.analyze' },
      ])
    },
  )

  it.each([
    [
      'is not scheduled',
      { jobName: NEXT_FAMILY, schedule: 'none' },
      [NEXT_JOB_ROW, nextEntryPoint('schedule')],
    ],
    [
      'holds no capability',
      NEXT_SCHEDULED,
      [
        nextEntryPoint('job', { action: UNGATED_ACTION, capability: 'none' }),
        nextEntryPoint('schedule', { action: UNGATED_ACTION, capability: 'none' }),
      ],
    ],
    [
      'fires for one Property, which the gate decides itself',
      NEXT_SCHEDULED,
      [nextEntryPoint('job', { resourceScope: 'property' })],
    ],
  ])('leaves out a family that %s', (_why, family, catalogue) => {
    expect(gatedTenantCrossSchedules([family], catalogue)).toEqual([])
  })

  it('names how every capability-gated tenant-cross schedule decides its candidates', () => {
    expect(GATED_TENANT_CROSS_SCHEDULES.length).toBeGreaterThan(0)
    expect(Object.keys(CANDIDATE_DECISIONS).sort()).toEqual(
      GATED_TENANT_CROSS_SCHEDULES.map((schedule) => schedule.jobName).sort(),
    )
  })

  it('covers exactly the gated families whose firing the gate admits with everything switched off', async () => {
    installPolicy({ BETA_CAPABILITIES_OFF: 'all' })

    const firings = await Promise.all(
      SCHEDULED_FAMILIES.map(async ({ jobName }) => ({
        jobName,
        firing: await gateJob(jobName, {}, `schedule:${jobName}`, 'schedule'),
      })),
    )
    const admittedUnderACapability = firings
      .filter(
        ({ firing }) =>
          firing.kind === 'allow' &&
          capabilityForSystemAction(firing.decision.action) !== 'none',
      )
      .map(({ jobName }) => jobName)

    expect(admittedUnderACapability.sort()).toEqual(
      GATED_TENANT_CROSS_SCHEDULES.map((schedule) => schedule.jobName).sort(),
    )
  })

  it.each(schedulesDecidedBy('scope_authorizer'))(
    '%s is admitted while its capability is switched off, so only its handler can stop',
    async (jobName, schedule) => {
      installPolicy({
        BETA_ALLOWLIST_ORGS: '*',
        BETA_CAPABILITIES_OFF: schedule.capability,
      })

      const firing = await gateJob(jobName, {}, `schedule:${jobName}`, 'schedule')

      expect({ kind: firing.kind, reason: firing.decision.reason }).toEqual({
        kind: 'allow',
        reason: 'allowed',
      })
    },
  )

  it.each(schedulesDecidedBy('scope_authorizer'))(
    '%s is given a scope authorizer for its own action where the worker registers it',
    (jobName, schedule) => {
      const bootstrap = readFileSync(join(ROOT, 'src/bootstrap.ts'), 'utf8')

      expect(
        new RegExp(
          `createScheduledScopeAuthorizer\\(\\s*'${escapeRegExp(schedule.row.action)}',?\\s*\\)`,
          'u',
        ).test(bootstrap),
        `${jobName} fires tenant-cross under ${schedule.capability}: bootstrap must hand its handler createScheduledScopeAuthorizer('${schedule.row.action}'), and the handler must ask it about each Organization and Property before acting for them`,
      ).toBe(true)
    },
  )

  it.each(schedulesDecidedBy('scope_authorizer'))(
    "%s's scope authorizer refuses a stopped Organization and allows the others",
    async (jobName, schedule) => {
      const decision = CANDIDATE_DECISIONS[jobName]
      if (decision?.kind !== 'scope_authorizer') {
        throw new Error(`${jobName} does not name a scope authorizer`)
      }
      const authorize = createScheduledScopeAuthorizer(schedule.row.action)
      const verdicts: Record<string, boolean> = {}

      installPolicy({ BETA_ALLOWLIST_ORGS: '*' })
      verdicts.open = await authorize(ORGANIZATION, PROPERTY)
      installPolicy({
        BETA_ALLOWLIST_ORGS: '*',
        BETA_CAPABILITIES_OFF: schedule.capability,
      })
      verdicts.capabilityOff = await authorize(ORGANIZATION, PROPERTY)
      installPolicy({ BETA_ALLOWLIST_ORGS: '*', BETA_CAPABILITIES_OFF: 'all' })
      verdicts.everythingOff = await authorize(ORGANIZATION, PROPERTY)
      installPolicy({ BETA_ALLOWLIST_ORGS: '*', BETA_SUSPENDED_ORGS: ORGANIZATION })
      verdicts.suspended = await authorize(ORGANIZATION, PROPERTY)
      verdicts.otherWhileSuspended = await authorize(OTHER_ORGANIZATION, PROPERTY)
      installPolicy({ BETA_ALLOWLIST_ORGS: OTHER_ORGANIZATION })
      verdicts.offAllowlist = await authorize(ORGANIZATION, PROPERTY)

      expect(verdicts).toEqual({
        open: true,
        capabilityOff: false,
        everythingOff: false,
        suspended: false,
        otherWhileSuspended: true,
        offAllowlist: decision.offAllowlist === 'allowed',
      })
    },
  )

  it.each(schedulesDecidedBy('scoped_entry_point'))(
    '%s leaves the governed work to a scoped entry point under the same capability',
    (jobName, schedule) => {
      const decision = CANDIDATE_DECISIONS[jobName]
      if (decision?.kind !== 'scoped_entry_point') {
        throw new Error(`${jobName} does not name a scoped entry point`)
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
        `${jobName} names ${decision.entryPoint}, which must be a job or consumer the gate decides per Organization under ${schedule.capability}`,
      ).toEqual({ capability: schedule.capability, scoped: true })
    },
  )

  it('records no undecided schedule beyond the one known gap', () => {
    // This list may only shrink. A new schedule that acts for tenants gets a
    // scope authorizer; it is never added here.
    expect(schedulesDecidedBy('undecided').map(([jobName]) => jobName)).toEqual([
      'release-response-target-reminders',
    ])
  })
})
