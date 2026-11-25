// Property Google rating goal — the command and read schemas (zod).
//
// Imported by the server functions for `.validator(...)` only and by forms;
// never re-exported from a server-function module, so these zod calls stay
// out of first paint (#794). The read results are typed in
// rating-goals/contracts.ts, which has no values.
//
// The schemas check shape and range. Whether a target is above what Google
// shows (or a kept tenth at or below it) needs Google's current number, so the
// command decides that (`invalid_target`); whether a planned quality clears its
// target's floor depends on the plan's target, so the command decides that
// too (`invalid_quality`).
//
// A pace is sent in tenths of a review a week (`paceTenthsPerWeek`).

import { z } from 'zod/v4'
import {
  MAX_PACE_TENTHS_PER_WEEK,
  MIN_PACE_TENTHS_PER_WEEK,
} from '../domain/rating-goal-pace'
import { PERFECT_TENTHS } from '../domain/rating-goal-stops'
import { LOWEST_TARGET_TENTHS, RATING_GOAL_MODES } from '../domain/rating-goal'

const uuid = z.uuid()

/** A target in tenths of a star: 45 is 4.5. */
const targetTenthsSchema = z.int().min(LOWEST_TARGET_TENTHS).max(PERFECT_TENTHS)

/** New reviews a week in tenths: 105 is 1.5 a day. */
const paceTenthsSchema = z
  .int()
  .min(MIN_PACE_TENTHS_PER_WEEK)
  .max(MAX_PACE_TENTHS_PER_WEEK)

/** The planned average stars of new reviews, in tenths: 45 is 4.5★. */
const qualityTenthsSchema = z.int().min(LOWEST_TARGET_TENTHS).max(PERFECT_TENTHS)

const modeSchema = z.enum(RATING_GOAL_MODES)

/** Every rating goal read names one Property. */
export const ratingGoalPropertySchema = z.object({ propertyId: uuid })

/** A climb goal carries a planned quality and a pace; a keep goal carries neither. */
export const setRatingGoalSchema = z
  .object({
    propertyId: uuid,
    mode: modeSchema,
    targetTenths: targetTenthsSchema,
    qualityTenths: qualityTenthsSchema.nullable(),
    paceTenthsPerWeek: paceTenthsSchema.nullable().optional(),
  })
  .refine(
    (input) =>
      input.mode === 'climb'
        ? typeof input.paceTenthsPerWeek === 'number'
        : input.paceTenthsPerWeek === null,
    {
      path: ['paceTenthsPerWeek'],
      message: 'A goal to climb needs a pace; a goal to keep has none',
    },
  )
  .refine((input) => (input.mode === 'climb') === (input.qualityTenths !== null), {
    path: ['qualityTenths'],
    message: 'A goal to climb needs a planned quality; a goal to keep has none',
  })
  .transform((input) => ({
    ...input,
    paceTenthsPerWeek: input.paceTenthsPerWeek ?? null,
  }))

/** Any of target, quality, pace and mode, against the version the form was opened on. */
export const changeRatingGoalSchema = z
  .object({
    propertyId: uuid,
    goalId: uuid,
    expectedVersion: z.int().min(1),
    mode: modeSchema.optional(),
    targetTenths: targetTenthsSchema.optional(),
    qualityTenths: qualityTenthsSchema.nullable().optional(),
    paceTenthsPerWeek: paceTenthsSchema.nullable().optional(),
  })
  .refine(
    (input) =>
      input.mode !== undefined ||
      input.targetTenths !== undefined ||
      input.qualityTenths !== undefined ||
      input.paceTenthsPerWeek !== undefined,
    { message: 'Change the target, the quality, the pace or the mode' },
  )

export const endRatingGoalSchema = z.object({
  propertyId: uuid,
  goalId: uuid,
  expectedVersion: z.int().min(1),
})

/**
 * Keep the pace for this week: the Monday check-in of `weekStart` (last week's
 * Monday, as the card read sent it) is answered.
 */
export const keepRatingGoalPaceSchema = z.object({
  propertyId: uuid,
  goalId: uuid,
  weekStart: z.iso.date(),
})

export type SetRatingGoalSchemaInput = z.infer<typeof setRatingGoalSchema>
export type ChangeRatingGoalSchemaInput = z.infer<typeof changeRatingGoalSchema>
export type EndRatingGoalSchemaInput = z.infer<typeof endRatingGoalSchema>
