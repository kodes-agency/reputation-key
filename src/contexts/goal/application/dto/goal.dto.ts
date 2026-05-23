// Goal context — Zod input schemas for server functions

import { z } from 'zod/v4'
import {
  METRIC_KEYS,
  AGGREGATION_FUNCTIONS,
  type MetricKey,
  type AggregationFunction,
} from '#/shared/domain/metric-keys'

// ── Enums ────────────────────────────────────────────────────────────────

const goalTypeSchema = z.enum(['open', 'one_shot', 'rolling', 'recurring'])
const goalStatusSchema = z.enum(['active', 'completed', 'expired', 'cancelled'])
const recurrenceFrequencySchema = z.enum(['weekly', 'monthly', 'quarterly'])

// z.enum() requires [string, ...string[]] — spread from const arrays satisfies this.
const aggregationFunctionValues = [...AGGREGATION_FUNCTIONS] as [
  AggregationFunction,
  ...AggregationFunction[],
]
const metricKeyValues = [...METRIC_KEYS] as [MetricKey, ...MetricKey[]]

// ── createGoal ───────────────────────────────────────────────────────────

export const createGoalSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
  portalId: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  staffId: z.string().min(1).optional(),
  name: z
    .string()
    .min(1, 'Goal name is required')
    .max(200, 'Name must be at most 200 characters'),
  description: z
    .string()
    .max(1000, 'Description must be at most 1000 characters')
    .optional(),
  goalType: goalTypeSchema,
  aggregationFunction: z.enum(aggregationFunctionValues),
  metricKey: z.enum(metricKeyValues),
  targetValue: z.number().positive('Target value must be positive'),
  periodStart: z.string().datetime({ local: true }).optional(),
  periodEnd: z.string().datetime({ local: true }).optional(),
  recurrenceRule: z
    .object({
      frequency: recurrenceFrequencySchema,
    })
    .optional(),
  rollingWindowDays: z
    .number()
    .int()
    .positive('Rolling window days must be a positive integer')
    .optional(),
})

export type CreateGoalInput = z.infer<typeof createGoalSchema>

// ── updateGoal ───────────────────────────────────────────────────────────

export const updateGoalSchema = z.object({
  goalId: z.string().min(1, 'Goal ID is required'),
  targetValue: z.number().positive('Target value must be positive').optional(),
  recurrenceRule: z
    .object({
      frequency: recurrenceFrequencySchema,
    })
    .optional(),
})

export type UpdateGoalInput = z.infer<typeof updateGoalSchema>

// ── cancelGoal ───────────────────────────────────────────────────────────

export const cancelGoalSchema = z.object({
  goalId: z.string().min(1, 'Goal ID is required'),
})

export type CancelGoalInput = z.infer<typeof cancelGoalSchema>

// ── listGoals ────────────────────────────────────────────────────────────

export const listGoalsSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
  portalId: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  staffId: z.string().min(1).optional(),
  status: goalStatusSchema.optional(),
  goalType: goalTypeSchema.optional(),
})

export type ListGoalsInput = z.infer<typeof listGoalsSchema>

// ── getGoal ──────────────────────────────────────────────────────────────

export const getGoalSchema = z.object({
  goalId: z.string().min(1, 'Goal ID is required'),
})

export type GetGoalInput = z.infer<typeof getGoalSchema>

// ── Re-exports for UI layer ─────────────────────────────────────────
// Components can only import from application/, not domain/.
// Re-export the types and helpers that components need.

export type { Goal, GoalProgress, GoalType, GoalStatus } from '../../domain/types'
export { deriveEntityScope } from '../../domain/types'
