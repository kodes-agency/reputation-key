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
  type ScenarioResult,
} from '../src/shared/testing/scenario/builder.server'
import { createInvariantCheckers, runInvariants } from '../src/shared/testing/invariants'
import { organization } from '../src/shared/db/schema/auth'
import { properties } from '../src/shared/db/schema/property.schema'
import type { Container } from '../src/composition'

const MS_PER_DAY = 86_400_000

// Job names for time-travel triggering
import { JOB_NAME as PURGE_JOB } from '../src/contexts/review/infrastructure/jobs/purge-expired-reviews.job'
import { JOB_NAME as REFRESH_JOB } from '../src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job'
// NOTE: `reconcile-goal-progress` and `spawn-recurring-instances` used to be
// enqueued here too. They were removed because the Goal context is dark: the
// governed Goal runtime registers neither handler, and neither job name exists
// in JOB_FAMILY_ROWS — `assertJobReadiness` clause (b) would fail worker boot
// if either were registered. Enqueuing them printed a "✓ Reconcile goal
// progress" for work that provably never ran. Removing them deletes a FALSE
// SIGNAL, not functionality: Goal still has scheduled work that no handler
// serves. Whoever wires the Goal runtime must restore both enqueues here AND
// add the two catalogue rows.
import {
  addOrganizationCapability,
  listOrganizationCapabilities,
  listProvisionablePropertyIds,
  provisionPropertyCapabilitiesFromOrganization,
  setOrganizationPolicy,
} from '../src/contexts/identity/infrastructure/repositories/policy-state.repository'
import { SEED_BETA_CAPABILITIES } from '../src/shared/config/local-stack-contract'

const args = process.argv.slice(2)
const orgArg = args.find((a) => a.startsWith('--org='))
const runInv = args.includes('--invariants')

async function resolveOrgId(container: Container): Promise<string> {
  if (orgArg) {
    const orgId = orgArg.replace('--org=', '')
    // An explicit --org is the CI path (`--org=sim-ci-org`) and runs against a
    // freshly migrated, EMPTY database, so the row this id names may not exist
    // yet. Everything downstream — the capability allowlist first, then the
    // scenario — carries an FK to `organization`, so create it here rather
    // than letting `organization_policy_organization_id_fkey` fail. Mirrors how
    // the isolation org is created below. Idempotent for repeat local runs.
    await container.db
      .insert(organization)
      .values({
        id: orgId,
        name: `Simulation org (${orgId})`,
        slug: orgId,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
    return orgId
  }
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

/**
 * Grant an organization the beta capability set.
 *
 * Without this a seeded database looks complete but every non-core feature is
 * dark: Portals, Teams, Goals and Recognition all deny with
 * `org_not_allowlisted` / `property_not_allowlisted`, so a developer can see
 * seeded portals in the database yet cannot create one through the product.
 *
 * Runs BEFORE the scenario so properties created through the real use case are
 * provisioned from this allowlist on the way in. Idempotent: already-held
 * capabilities are skipped, because the primary key rejects a duplicate.
 */
async function grantOrgBetaCapabilities(
  container: Container,
  orgId: string,
): Promise<void> {
  const db = container.db
  await setOrganizationPolicy(db, {
    organizationId: orgId,
    cohort: 'beta-local',
    suspendedAt: null,
    suspendedReason: null,
  })

  const held = new Set(await listOrganizationCapabilities(db, orgId))
  let added = 0
  for (const capability of SEED_BETA_CAPABILITIES) {
    if (held.has(capability)) continue
    await addOrganizationCapability(db, orgId, capability, 'seed')
    added += 1
  }
  console.log(
    `✓ Capabilities: org ${orgId} holds ${SEED_BETA_CAPABILITIES.length} (${added} new)`,
  )
}

/**
 * Cascade an organization's allowlist onto every active property it owns.
 *
 * Runs LAST, after every scenario: the scenario builder inserts property rows
 * directly (`builder.server.ts`) rather than through the createProperty use
 * case, so those properties never pass the provisioning step and would stay
 * dark. `ON CONFLICT DO NOTHING` makes this safe over already-provisioned
 * properties, and each write bumps `policy_version` in the same statement, so
 * a running dev server observes the change on its next refresh — no restart.
 */
async function cascadeCapabilitiesToProperties(
  container: Container,
  orgIds: readonly string[],
): Promise<void> {
  const db = container.db
  let granted = 0
  let total = 0
  for (const orgId of orgIds) {
    const propertyIds = await listProvisionablePropertyIds(db, orgId)
    total += propertyIds.length
    for (const propertyId of propertyIds) {
      const added = await provisionPropertyCapabilitiesFromOrganization(db, {
        organizationId: orgId,
        propertyId,
        createdBy: 'seed',
      })
      if (added.length > 0) granted += 1
    }
  }
  console.log(
    `\n✓ Capabilities cascaded: ${granted} of ${total} properties newly provisioned`,
  )
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

/**
 * Every row the spec asked for must exist. `buildScenario` logs and continues
 * past a failed insert, so a fixture regression used to show up only as a
 * smaller printed number that nobody was comparing against anything. Compare
 * it here and fail the run.
 */
function assertBuiltCounts(
  label: string,
  spec: ScenarioSpec,
  result: ScenarioResult,
): void {
  const sum = (pick: (p: ScenarioSpec['properties'][number]) => number): number =>
    spec.properties.reduce((total, p) => total + pick(p), 0)

  const expected = {
    propertiesCreated: spec.properties.length,
    portalsCreated: spec.properties.length,
    reviewsCreated: sum((p) => p.reviews?.length ?? 0),
    repliesCreated: sum((p) => (p.reviews ?? []).filter((r) => r.reply).length),
    goalsCreated: sum((p) => p.goals?.length ?? 0),
    guestInteractions: sum(
      (p) => (p.guest?.scans ?? 0) + (p.guest?.ratings ?? 0) + (p.guest?.feedback ?? 0),
    ),
  }

  const mismatches = Object.entries(expected).filter(
    ([key, want]) => result[key as keyof typeof expected] !== want,
  )
  if (mismatches.length === 0) return

  console.error(`\n✗ ${label}: built counts do not match the requested ScenarioSpec`)
  for (const [key, want] of mismatches) {
    console.error(
      `  ${key}: requested ${want}, built ${result[key as keyof typeof expected]}`,
    )
  }
  console.error(
    '  Rows were silently skipped — see the "Sim ... failed" warn lines above.',
  )
  process.exit(1)
}

async function main(): Promise<void> {
  const { container, queue, advanceClock } = await createSimulationContainer()
  const orgId = await resolveOrgId(container)

  // Before the scenario: the org allowlist must exist so every property the
  // scenario creates is provisioned from it on the way in.
  await grantOrgBetaCapabilities(container, orgId)

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
  assertBuiltCounts('Round 1', spec, result)

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
  // The isolation org gets the same posture on purpose: isolation is about
  // data separation, not capability posture, and a second org that silently
  // denies every feature reads as a bug rather than as a test fixture.
  await grantOrgBetaCapabilities(container, org2Id)
  const spec2: ScenarioSpec = {
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
  }
  const result2 = await buildScenario(container, spec2)
  assertBuiltCounts('Org 2', spec2, result2)
  console.log(`\n✓ Multi-tenant: org 2 created (${result2.reviewsCreated} reviews)`)

  // After every scenario, before anything reads policy: the scenario builder
  // inserts property rows directly, so those properties have no allowlist yet.
  await cascadeCapabilitiesToProperties(container, [orgId, org2Id])

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
    // Goal's reconcile/spawn jobs deliberately absent — see the note by the
    // job-name imports at the top of this file.
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
