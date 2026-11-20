// Goals, Google rating goals, Metric readings, Google numbers and merchant AI
// consent for the server-function harness, written in the shape production
// leaves them; consent goes through Identity's own consent store.
//
// Goal Program months cannot be deleted: a file that seeds them names
// GOAL_CLEANUP_TABLES and GOAL_CLEANUP_TRIGGERS in its harness options.

import { randomUUID } from 'node:crypto'
import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import {
  MERCHANT_AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION,
  MERCHANT_AI_REDACTION_PROFILE_FAMILY,
  MERCHANT_AI_SOURCE_POLICY_ID,
} from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import { createMerchantAiAuthorizationStore } from '#/contexts/identity/consent/merchant-ai-authorization.repository.server'
import { CURRENT_MERCHANT_AI_CAPABILITIES } from '#/contexts/identity/consent/merchant-ai-authorization.server'
import type { CurrentMerchantAiCapability } from '#/contexts/identity/domain/merchant-ai-authorization'
import type { PropertyRatingGoal } from '#/contexts/reporting/domain/rating-goal'
import { legacyPacePerWeek } from '#/contexts/reporting/domain/rating-goal-pace'
import {
  METRIC_DEFINITION_IDS,
  METRIC_VERSION_IDS,
} from '#/contexts/reporting/application/public-api'
import { getDb } from '#/shared/db'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import type { GuardTrigger } from './server-function-harness'
import type { TestMember } from './server-function-identity-seeds'
import type { TestProperty } from './server-function-property-seeds'
import type { HarnessSeedContext } from './server-function-seed-context'

/** Goal tables, children first, for `cleanupTables` of a file that seeds goals. */
export const GOAL_CLEANUP_TABLES = [
  'goal_result_revisions',
  'goal_month_target_changes',
  'goal_monthly_results',
  'goal_subject_assignments',
  'goal_program_versions',
  'goal_programs',
  'property_rating_goal_changes',
  'property_rating_goals',
] as const

/** The guard that refuses every delete of a goal month. */
export const GOAL_CLEANUP_TRIGGERS: readonly GuardTrigger[] = [
  { table: 'goal_monthly_results', trigger: 'goal_monthly_results_guard' },
]

const DAY_MS = 86_400_000

export type SeededMetric =
  'qualified_scans' | 'portal_rating_count' | 'portal_rating_average'

export type SeededSubject =
  | Readonly<{ kind: 'property' }>
  | Readonly<{ kind: 'portal'; portalId: string }>
  | Readonly<{ kind: 'portal_group'; groupId: string }>

export type SeededGoalMonth = Readonly<{
  programId: string
  versionId: string
  assignmentId: string
  resultId: string
}>

const METRICS: Readonly<
  Record<SeededMetric, Readonly<{ definition: string; version: string; reading: string }>>
> = {
  qualified_scans: {
    definition: METRIC_DEFINITION_IDS.qualifiedScan,
    version: METRIC_VERSION_IDS.qualifiedScanGoal,
    reading: 'portal.qualified_scan',
  },
  portal_rating_count: {
    definition: METRIC_DEFINITION_IDS.portalRatingCount,
    version: METRIC_VERSION_IDS.portalRatingCountGoal,
    reading: 'portal.rating_count',
  },
  portal_rating_average: {
    definition: METRIC_DEFINITION_IDS.portalRatingAverage,
    version: METRIC_VERSION_IDS.portalRatingAverageGoal,
    reading: 'portal.rating_average',
  },
}

const AUGUST_2026 = { start: '2026-08-01T00:00:00Z', end: '2026-09-01T00:00:00Z' }

export type SeedGoalProgramOptions = Readonly<{
  metric?: SeededMetric
  subject?: SeededSubject
  target?: number
  programStatus?: 'scheduled' | 'active' | 'paused' | 'ended'
  /** The running month, as instants. Defaults to August 2026 in UTC. */
  period?: Readonly<{ start: string; end: string }>
}>

export type SeedRatingGoalOptions = Partial<
  Pick<
    PropertyRatingGoal,
    | 'mode'
    | 'targetTenths'
    | 'qualityTenths'
    | 'paceTenthsPerWeek'
    | 'sourceEpoch'
    | 'createdAt'
    | 'baseline'
  >
> &
  Readonly<{ createdBy: TestMember }>

export type SeedMetricReadingOptions = Readonly<{
  metric?: SeededMetric
  /** How many readings of one each. Defaults to 1. */
  count?: number
  /** When the readings happened. */
  at: Date
  portalId?: string
  groupId?: string
}>

export type SeedGoogleNumbersOptions = Readonly<{
  reviewCount?: number
  averageRating?: number
  /** When the snapshot was verified. Defaults to the clock. */
  evaluatedAt?: Date
}>

export type SeedMerchantAiConsentOptions = Readonly<{
  /** The AccountAdmin who gives consent. */
  actor: TestMember
  capabilities?: ReadonlyArray<CurrentMerchantAiCapability>
}>

export type TestMerchantAiConsent = Readonly<{ stateVersion: number }>

export type GoalSeeds = Readonly<{
  /** A Goal Program with its version, one subject and its running month. */
  seedGoalProgram: (
    property: TestProperty,
    options?: SeedGoalProgramOptions,
  ) => Promise<SeededGoalMonth>
  /** An active Google rating goal. */
  seedRatingGoal: (
    property: TestProperty,
    options: SeedRatingGoalOptions,
  ) => Promise<Readonly<{ id: string }>>
  /** Governed Metric readings of one, as the guest gateway records a scan or rating. */
  seedMetricReading: (
    property: TestProperty,
    options: SeedMetricReadingOptions,
  ) => Promise<readonly string[]>
  /** The Property's current Google review count and rating, at its source epoch. */
  seedGoogleNumbers: (
    property: TestProperty,
    options?: SeedGoogleNumbersOptions,
  ) => Promise<void>
  /**
   * Merchant AI enabled for the Property under the notice in force. The
   * Property needs a Google binding (`seedProperty(org, { google: true })`).
   */
  seedMerchantAiConsent: (
    property: TestProperty,
    options: SeedMerchantAiConsentOptions,
  ) => Promise<TestMerchantAiConsent>
}>

async function sourceEpochOf(
  context: HarnessSeedContext,
  property: TestProperty,
): Promise<number> {
  const { rows } = await context
    .pool()
    .query<{ source_epoch: number }>(
      'SELECT source_epoch FROM properties WHERE id = $1',
      [property.id],
    )
  return rows[0]?.source_epoch ?? 0
}

export function goalSeeds(context: HarnessSeedContext): GoalSeeds {
  const { pool } = context
  return {
    seedGoalProgram: async (property, options = {}) => {
      const metric = options.metric ?? 'qualified_scans'
      const subject = options.subject ?? { kind: 'property' }
      const period = options.period ?? AUGUST_2026
      const ids = {
        programId: context.newId(),
        versionId: context.newId(),
        assignmentId: context.newId(),
        resultId: context.newId(),
      }
      const scope = [property.organizationId, property.id]
      await pool().query(
        `INSERT INTO goal_programs
           (id, organization_id, property_id, name, status, current_version,
            created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'Seeded goal', $4, 1, 'manager-1', $5, $5)`,
        [ids.programId, ...scope, options.programStatus ?? 'active', period.start],
      )
      await pool().query(
        `INSERT INTO goal_program_versions
           (id, program_id, organization_id, property_id, version,
            metric_definition_id, metric_definition_version_id, metric_key,
            metric_minimum_sample, target_value, property_timezone, effective_from,
            change_reason, created_by, created_at)
         VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, 'UTC', $10, 'created',
           'manager-1', $10)`,
        [
          ids.versionId,
          ids.programId,
          ...scope,
          METRICS[metric].definition,
          METRICS[metric].version,
          metric,
          metric === 'portal_rating_average' ? 10 : 0,
          options.target ?? 10,
          period.start,
        ],
      )
      await pool().query(
        `INSERT INTO goal_subject_assignments
           (id, program_id, program_version_id, organization_id, property_id,
            metric_key, subject_kind, property_subject_id, portal_group_id, portal_id,
            effective_from, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manager-1', $11)`,
        [
          ids.assignmentId,
          ids.programId,
          ids.versionId,
          ...scope,
          metric,
          subject.kind,
          subject.kind === 'property' ? property.id : null,
          subject.kind === 'portal_group' ? subject.groupId : null,
          subject.kind === 'portal' ? subject.portalId : null,
          period.start,
        ],
      )
      // A month still running is open and `updating` with no value, as
      // production leaves it.
      await pool().query(
        `INSERT INTO goal_monthly_results
           (id, assignment_id, program_id, program_version_id, organization_id,
            property_id, period_start, period_end, property_timezone, status,
            evaluation_state, sample_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UTC', 'open', 'updating', 0, $7, $7)`,
        [
          ids.resultId,
          ids.assignmentId,
          ids.programId,
          ids.versionId,
          ...scope,
          period.start,
          period.end,
        ],
      )
      return ids
    },

    seedRatingGoal: async (property, options) => {
      const id = context.newId()
      const createdAt =
        options.createdAt ?? new Date(context.clock().getTime() - 7 * DAY_MS)
      const pace =
        options.paceTenthsPerWeek === undefined ? 110 : options.paceTenthsPerWeek
      const baseline = options.baseline ?? {
        reviewCount: 40,
        googleAverage: 4.3,
        exactAverage: 4.29,
      }
      await pool().query(
        `INSERT INTO property_rating_goals
           (id, organization_id, property_id, source_epoch, mode, target_tenths,
            quality_tenths, pace_tenths_per_week, pace_per_week, status,
            baseline_review_count, baseline_google_average, baseline_exact_average,
            last_displayed_tenths, last_evaluated_status, last_known_status,
            created_by, created_at, updated_at, pace_since)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11, $12,
                 43, 'on_pace', 'on_pace', $13, $14, $14, $14)`,
        [
          id,
          property.organizationId,
          property.id,
          options.sourceEpoch ?? (await sourceEpochOf(context, property)),
          options.mode ?? 'climb',
          options.targetTenths ?? 45,
          options.qualityTenths === undefined ? 47 : options.qualityTenths,
          pace,
          pace === null ? null : legacyPacePerWeek(pace),
          baseline.reviewCount,
          baseline.googleAverage,
          baseline.exactAverage,
          options.createdBy.userId,
          createdAt,
        ],
      )
      return { id }
    },

    seedMetricReading: async (property, options) => {
      const metric = METRICS[options.metric ?? 'qualified_scans']
      const sourceEventPrefix = `harness-${context.newId()}`
      const count = options.count ?? 1
      await pool().query(
        `INSERT INTO metric_readings (
           organization_id, property_id, portal_id, group_id, metric_key, value,
           definition_version_id, source_event_id, source_policy, exact_value,
           sample_count, attribution_quality, recorded_at, event_at,
           property_local_date, data_quality, retention_class
         )
         SELECT $1, $2, $3, $4, $5, 1, $6, $7 || '-' || series.n,
           'first_party_guest_gateway_metric', 1, 1, 'exact', $8::timestamptz,
           $8::timestamptz, to_char($8::timestamptz, 'YYYY-MM-DD'), 'exact', 'standard'
         FROM generate_series(1, $9::integer) AS series(n)`,
        [
          property.organizationId,
          property.id,
          options.portalId ?? null,
          options.groupId ?? null,
          metric.reading,
          metric.version,
          sourceEventPrefix,
          options.at.toISOString(),
          count,
        ],
      )
      return Array.from(
        { length: count },
        (_, index) => `${sourceEventPrefix}-${index + 1}`,
      )
    },

    seedGoogleNumbers: async (property, options = {}) => {
      await pool().query(
        `INSERT INTO metric_current_google_reputation_snapshots (
           property_id, organization_id, source_epoch, source_run_id, source_event_id,
           review_count, average_rating, evaluated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          property.id,
          property.organizationId,
          await sourceEpochOf(context, property),
          randomUUID(),
          randomUUID(),
          options.reviewCount ?? 40,
          options.averageRating ?? 4.3,
          options.evaluatedAt ?? context.clock(),
        ],
      )
    },

    seedMerchantAiConsent: async (property, options) => {
      const sourceEpoch = await sourceEpochOf(context, property)
      await pool().query(
        `INSERT INTO review_ai_analysis_heads
           (organization_id, property_id, source_epoch, head_sequence)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT DO NOTHING`,
        [property.organizationId, property.id, sourceEpoch],
      )
      const store = createMerchantAiAuthorizationStore(
        getDb(),
        context.newId,
        replyScopeEffects,
      )
      const snapshot = await store.mutate({
        organizationId: property.organizationId,
        propertyId: property.id,
        actorUserId: options.actor.userId,
        idempotencyKey: `harness-consent-${context.newId()}`,
        expectedStateVersion: 0,
        operation: 'enable',
        state: 'enabled',
        capabilities: options.capabilities ?? CURRENT_MERCHANT_AI_CAPABILITIES,
        reasonCode: 'merchant_enabled',
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        sourcePolicyId: MERCHANT_AI_SOURCE_POLICY_ID,
        routingPolicyVersion: 1,
        providerDeploymentProfileVersion: MERCHANT_AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION,
        redactionProfileFamily: MERCHANT_AI_REDACTION_PROFILE_FAMILY,
        now: context.clock(),
        ceremonyId: context.newId(),
      })
      return { stateVersion: snapshot.stateVersion }
    },
  }
}
