// Goal event schemas, registered by ./schema-registrations.ts.
//
// The three monthly-result facts share one base contract and its two
// cross-field rules (the period is ordered; achievement matches the evaluation
// state), so they live together, apart from the registration list.

import { z } from 'zod/v4'

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

export const goalMonthlyResultClosedSchema = goalMonthlyResultBaseSchema
  .safeExtend({ status: z.literal('closed') })
  .superRefine((payload, ctx) => {
    if (payload.evaluationState === 'updating') {
      ctx.addIssue({ code: 'custom', message: 'closed result cannot be updating' })
    }
  })

export const goalMonthlyResultReconciledSchema = goalMonthlyResultBaseSchema.safeExtend({
  status: z.literal('reconciling'),
})

export const goalMonthlyResultRevisedSchema = goalMonthlyResultBaseSchema
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
