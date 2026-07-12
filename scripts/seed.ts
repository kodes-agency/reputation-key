// Seed/simulate script — builds a realistic multi-property dataset, exercises
// time-dependent jobs via clock advancement, and runs invariant checks.
//
// Usage:
//   pnpm seed                           # seed default scenario for first org
//   pnpm seed -- --org=ORG_ID           # seed for a specific org
//   pnpm seed -- --org=ORG_ID --invariants  # seed + invariant checks + time-travel
//
// Requires: DATABASE_URL in .env (same as the dev server).

import 'dotenv/config'
import { createSimulationContainer } from '../src/shared/testing/simulation-container.server'
import { organizationId, userId } from '../src/shared/domain/ids'
import type { AuthContext } from '../src/shared/domain/auth-context'
import {
  buildScenario,
  type ScenarioSpec,
} from '../src/shared/testing/scenario/builder.server'
import { createInvariantCheckers, runInvariants } from '../src/shared/testing/invariants'
import { organization } from '../src/shared/db/schema/auth'
import { properties } from '../src/shared/db/schema/property.schema'
import type { Container } from '../src/composition'

const MS_PER_DAY = 86_400_000

// Job names for time-travel triggering
import { JOB_NAME as PURGE_JOB } from '../src/contexts/review/infrastructure/jobs/purge-expired-reviews.job'
import { JOB_NAME as REFRESH_JOB } from '../src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job'
import { RECONCILE_GOAL_JOB_NAME as RECONCILE_JOB } from '../src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job'
import { SPAWN_RECURRING_JOB_NAME as SPAWN_JOB } from '../src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job'

const args = process.argv.slice(2)
const orgArg = args.find((a) => a.startsWith('--org='))
const runInv = args.includes('--invariants')

async function resolveOrgId(container: Container): Promise<string> {
  if (orgArg) return orgArg.replace('--org=', '')
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const result = await pool.query('SELECT id FROM organization LIMIT 1')
    const orgId = result.rows[0]?.id as string | undefined
    if (!orgId) {
      console.error('No organization found. Register one in the dev DB first.')
      process.exit(1)
    }
    return orgId
  } finally {
    await pool.end()
  }
}

function defaultScenario(orgId: string): ScenarioSpec {
  return {
    organizationId: orgId,
    properties: [
      {
        name: 'Sim Grand Hotel',
        slug: `sim-grand-${Date.now()}`,
        reviews: [
          { rating: 5, daysAgo: 2, text: 'Excellent stay!', reply: true },
          { rating: 4, daysAgo: 5, text: 'Very good overall.', reply: true },
          { rating: 1, daysAgo: 10, text: 'Terrible experience.' },
          { rating: 3, daysAgo: 15, text: 'It was OK.' },
          { rating: 2, daysAgo: 25, text: 'Below expectations.' },
          { rating: 5, daysAgo: 30, text: 'Amazing!' },
          { rating: 1, daysAgo: 3, text: 'Still waiting for a response.' },
          { rating: 2, daysAgo: 7, text: 'No one replied to me.' },
        ],
        scansPerDay: 12,
        scanHistoryDays: 30,
        guest: { scans: 10, ratings: 5, feedback: 3, overDays: 30 },
        goals: [
          { name: '100 Scans This Month', metricKey: 'portal.scan', targetValue: 100 },
        ],
      },
      {
        name: 'Sim Boutique Inn',
        slug: `sim-boutique-${Date.now()}`,
        reviews: [
          { rating: 4, daysAgo: 1, text: 'Charming place.', reply: true },
          { rating: 5, daysAgo: 4, text: 'Loved it!' },
          { rating: 1, daysAgo: 8, text: 'Room was dirty.' },
          { rating: 3, daysAgo: 20, text: 'Average.' },
        ],
        scansPerDay: 6,
        scanHistoryDays: 30,
        guest: { scans: 5, ratings: 3, feedback: 2, overDays: 30 },
        goals: [
          { name: '50 Scans This Month', metricKey: 'portal.scan', targetValue: 50 },
        ],
      },
    ],
  }
}

function printReport(
  label: string,
  report: Awaited<ReturnType<typeof runInvariants>>,
): void {
  console.log(
    `\n${report.ok ? '✓' : '✗'} ${label}: ${report.passed}/${report.totalCheckers} passed`,
  )
  if (report.violations.length > 0) {
    for (const v of report.violations) {
      const icon = v.severity === 'error' ? '✗' : '⚠'
      console.log(`  ${icon} [${v.checker}] ${v.message}`)
    }
  }
}

async function main(): Promise<void> {
  const { container, queue, advanceClock } = await createSimulationContainer()
  const orgId = await resolveOrgId(container)

  console.log(`Seeding scenario for org: ${orgId}`)
  const spec = defaultScenario(orgId)

  // ── Round 1: Build scenario + initial invariants ──
  const result = await buildScenario(container, spec)
  console.log('\n✓ Scenario built:')
  console.log(`  Properties: ${result.propertiesCreated}`)
  console.log(`  Portals:    ${result.portalsCreated}`)
  console.log(`  Reviews:    ${result.reviewsCreated}`)
  console.log(`  Replies:    ${result.repliesCreated}`)
  console.log(`  Goals:      ${result.goalsCreated}`)
  console.log(`  Guest:      ${result.guestInteractions}`)
  console.log(`  Events:     ${result.eventsEmitted}`)

  // ── Create second org for multi-tenant isolation testing ──
  const org2Id = `sim-org-2-${Date.now()}`
  await container.db
    .insert(organization)
    .values({
      id: org2Id,
      name: 'Sim Org 2 (Isolation Test)',
      slug: `sim-org-2-${Date.now()}`,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
  const result2 = await buildScenario(container, {
    organizationId: org2Id,
    properties: [
      {
        name: 'Sim Rival Hotel',
        slug: `sim-rival-${Date.now()}`,
        reviews: [{ rating: 1, daysAgo: 5, text: 'Cross-tenant test review.' }],
        scansPerDay: 3,
        scanHistoryDays: 7,
      },
    ],
  })
  console.log(`\n✓ Multi-tenant: org 2 created (${result2.reviewsCreated} reviews)`)

  // ── Badge awards pipeline ──
  console.log('\n── Badge Pipeline ──')
  const badgeDefs = await container.useCases.seedBadgeDefinitions()
  console.log(`  Definitions seeded: ${badgeDefs.length}`)
  const brandedOrgId = organizationId(orgId)
  const simCtx: AuthContext = {
    organizationId: brandedOrgId,
    userId: userId('sim-admin-00000000-0000-0000-0000-000000000001'),
    role: 'AccountAdmin',
  }
  for (const def of badgeDefs) {
    await container.badgePublicApi.setOrganizationBadgeEnablement(simCtx, {
      organizationId: brandedOrgId,
      badgeDefinitionId: def.id,
      enabled: true,
    })
  }
  console.log(`  Badges enabled for org: ${badgeDefs.length}`)
  const badgeResult = await container.useCases.reconcileBadgeDefinitions({
    organizationId: brandedOrgId,
  })
  console.log(`  Reconcile: ${JSON.stringify(badgeResult)}`)

  if (!runInv) {
    process.exit(0)
  }

  // ── Invariant check round 1 ──
  console.log('\n── Invariant Checks (pre-time-travel) ──')
  const checkers = createInvariantCheckers(container, queue)
  const report1 = await runInvariants(checkers, { organizationId: orgId, slaHours: 48 })
  printReport('Pre-time-travel', report1)

  // ── Round 2: Time-travel — advance clock 35 days + trigger jobs ──
  console.log('\n── Time-Travel: Advancing clock 35 days ──')
  advanceClock(35 * MS_PER_DAY)

  const timeDependentJobs = [
    { name: PURGE_JOB, label: 'Purge expired reviews' },
    { name: REFRESH_JOB, label: 'Refresh expiring reviews' },
    { name: RECONCILE_JOB, label: 'Reconcile goal progress' },
    { name: SPAWN_JOB, label: 'Spawn recurring instances' },
  ]

  for (const job of timeDependentJobs) {
    try {
      await queue.add(job.name, {})
      console.log(`  ✓ ${job.label}`)
    } catch (e) {
      console.log(`  ✗ ${job.label}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ── Invariant check round 2 ──
  console.log('\n── Invariant Checks (post-time-travel) ──')
  const report2 = await runInvariants(checkers, { organizationId: orgId, slaHours: 48 })
  printReport('Post-time-travel', report2)

  // ── Multi-tenant isolation check ──
  console.log('\n── Multi-Tenant Isolation Check ──')
  const checkers2 = createInvariantCheckers(container, queue)
  const tenantReport = await runInvariants(checkers2, {
    organizationId: org2Id,
    slaHours: 48,
  })
  printReport(`Org 2 (${org2Id})`, tenantReport)

  // Fail on error-level violations (warnings are OK for CI)
  const allViolations = [
    ...report1.violations,
    ...report2.violations,
    ...tenantReport.violations,
  ]
  const errors = allViolations.filter((v) => v.severity === 'error')
  if (errors.length > 0) {
    console.error(`\n✗ ${errors.length} error-level violation(s) — CI gate failed`)
    process.exit(1)
  }
  console.log('\n✓ All invariant checks passed (no error-level violations)')
  process.exit(0)
}

main().catch((e) => {
  console.error('\n✗ Simulation failed:', e)
  process.exit(1)
})
