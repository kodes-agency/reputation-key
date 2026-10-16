// Goal event schemas, registered by ./schema-registrations.ts.
//
// The three monthly-result facts share one base contract and its two
// cross-field rules (the period is ordered; achievement matches the evaluation
// state), so they live together, apart from the registration list.

import { z } from 'zod/v4'
import { registerEventSchema } from './schema-registry'

const goalMonthlyResultBaseSchema = z
  .object({
    // Tenant scope also lives in the durable envelope. These two fields are
    // optional only for replay of rows written by the pre-adapter producer.
    organizationId: z.string().trim().min(1).optional(),
    propertyId: z.uuid().optional(),
    programId: z.uuid(),
    programVersionId: z.uuid(),
    assignmentId: z.uuid(),
    monthlyResultId: z.uuid(),
    periodStart: z.iso.datetime(),
    periodEnd: z.iso.datetime(),
    evaluationState: z.enum([
      'eligible',
      'updating',
      'insufficient_data',
      'unavailable',
      'quarantined',
    ]),
    achieved: z.boolean().nullable(),
    // The outbox row created_at remains authoritative for the old producer.
    occurredAt: z.iso.datetime().optional(),
  })
  .superRefine((payload, ctx) => {
    if (new Date(payload.periodEnd) <= new Date(payload.periodStart)) {
      ctx.addIssue({ code: 'custom', message: 'periodEnd must follow periodStart' })
    }
    if (
      (payload.evaluationState === 'eligible' && payload.achieved === null) ||
      (payload.evaluationState !== 'eligible' && payload.achieved !== null)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'achievement must match the evaluation state',
      })
    }
  })

const goalMonthlyResultClosedSchema = goalMonthlyResultBaseSchema
  .safeExtend({ status: z.literal('closed') })
  .superRefine((payload, ctx) => {
    if (payload.evaluationState === 'updating') {
      ctx.addIssue({ code: 'custom', message: 'closed result cannot be updating' })
    }
  })

const goalMonthlyResultReconciledSchema = goalMonthlyResultBaseSchema.safeExtend({
  status: z.literal('reconciling'),
})

const goalMonthlyResultRevisedSchema = goalMonthlyResultBaseSchema
  .safeExtend({
    status: z.literal('closed'),
    revisionId: z.uuid(),
    revision: z.number().int().positive(),
    supersedesRevisionId: z.uuid().nullable(),
    outcomeChanged: z.boolean(),
    availabilityChanged: z.boolean(),
  })
  .superRefine((payload, ctx) => {
    if (payload.evaluationState === 'updating') {
      ctx.addIssue({ code: 'custom', message: 'closed result cannot be updating' })
    }
    if (
      (payload.revision === 1 && payload.supersedesRevisionId !== null) ||
      (payload.revision > 1 && payload.supersedesRevisionId === null)
    ) {
      ctx.addIssue({ code: 'custom', message: 'result revision lineage is invalid' })
    }
  })

// ── Property Google rating goal ─────────────────────────────────────

const tenthSchema = z.number().int().min(0).max(50)

/**
 * `goal.rating_goal.transitioned`: one fact per notice a rating goal's
 * evaluation raises (ADR 0067 decision 6). Closed enums and Property-level
 * figures only: Google's shown tenth, the goal's target and pace, and the
 * recent pace of new reviews. Never a figure RepKey works out from review
 * ratings (an average, a mix). Each transition carries exactly the figures its
 * notice states.
 */
const goalRatingGoalTransitionedSchema = z
  .object({
    organizationId: z.string().trim().min(1),
    propertyId: z.uuid(),
    goalId: z.uuid(),
    transition: z.enum([
      'reached',
      'google_rating_changed',
      'entered_below_pace',
      'entered_reviews_too_low',
      'keep_dropped_below',
    ]),
    mode: z.enum(['climb', 'keep']),
    targetTenths: z.number().int().min(10).max(50),
    shownTenths: tenthSchema.nullable(),
    previousTenths: tenthSchema.nullable(),
    // Legacy: whole reviews a week, the mirror of the tenths below (one
    // release). Widened to 350 (50 a day); still what Below pace needs, so a
    // fact from an older worker keeps validating.
    pacePerWeek: z.number().int().min(1).max(350).nullable(),
    /** The goal's pace in tenths of a review a week (migration 0060). */
    paceTenthsPerWeek: z.number().int().min(10).max(3500).nullable().optional(),
    recentPaceTenths: z.number().int().min(0).max(100_000).nullable(),
    paceWindow: z.enum(['last_4_weeks', 'since_set']).nullable(),
    occurredAt: z.iso.datetime(),
  })
  .superRefine((payload, ctx) => {
    const needs: Readonly<Record<typeof payload.transition, readonly string[]>> = {
      reached: ['shownTenths'],
      google_rating_changed: ['shownTenths', 'previousTenths'],
      entered_below_pace: ['pacePerWeek', 'recentPaceTenths', 'paceWindow'],
      entered_reviews_too_low: [],
      keep_dropped_below: ['shownTenths'],
    }
    const fields = payload as Readonly<Record<string, unknown>>
    for (const field of needs[payload.transition]) {
      if (fields[field] === null) {
        ctx.addIssue({ code: 'custom', message: `${payload.transition} needs ${field}` })
      }
    }
  })

/** The Goal facts, registered together by ./schema-registrations.ts. */
export function registerGoalEventSchemas(version: number): void {
  registerEventSchema({
    type: 'goal.monthly_result.closed',
    version,
    schema: goalMonthlyResultClosedSchema,
  })
  registerEventSchema({
    type: 'goal.monthly_result.reconciled',
    version,
    schema: goalMonthlyResultReconciledSchema,
  })
  registerEventSchema({
    type: 'goal.monthly_result.revised',
    version,
    schema: goalMonthlyResultRevisedSchema,
  })
  registerEventSchema({
    type: 'goal.rating_goal.transitioned',
    version,
    schema: goalRatingGoalTransitionedSchema,
  })
}
