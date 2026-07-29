// Goal-type decision table — the temporal validation rules behind buildGoal.
// Pure domain module: no IO, no clock — every field arrives as an input.
//
//   goalType   periodStart/End                       rollingWindowDays   recurrenceRule   parentGoalId
//   open       forbidden                              forbidden           forbidden        —
//   one_shot   required, end after start              forbidden           forbidden        —
//   rolling    forbidden                              required, > 0       forbidden        —
//   recurring  template: forbidden;                   forbidden           required         template ↔
//              instance: required, end after start                                         instance switch
//
// Rules evaluate in table order per goalType; the first matching rule wins.
// Codes/messages/contexts are identical to the 4-arm switch this replaced.

import type { GoalId } from '#/shared/domain/ids'
import { assertNever } from '#/shared/domain/assert'
import type { GoalType, RecurrenceRule } from './types'
import { goalError, type GoalError, type GoalErrorCode } from './errors'

export type GoalTemporalInput = Readonly<{
  goalType: GoalType
  periodStart: Date | null
  periodEnd: Date | null
  recurrenceRule: RecurrenceRule | null
  rollingWindowDays: number | null
  parentGoalId: GoalId | null
}>

// ── Named predicates (the cells of the table) ──────────────────

const hasPeriodDates = (i: GoalTemporalInput): boolean =>
  i.periodStart !== null || i.periodEnd !== null

const periodMissing = (i: GoalTemporalInput): boolean =>
  i.periodStart === null || i.periodEnd === null

const periodInverted = (i: GoalTemporalInput): boolean =>
  i.periodStart !== null && i.periodEnd !== null && i.periodEnd <= i.periodStart

const hasRollingWindow = (i: GoalTemporalInput): boolean => i.rollingWindowDays !== null

const rollingWindowMissingOrNonPositive = (i: GoalTemporalInput): boolean =>
  i.rollingWindowDays === null || i.rollingWindowDays <= 0

const hasRecurrenceRule = (i: GoalTemporalInput): boolean => i.recurrenceRule !== null

const recurrenceRuleMissing = (i: GoalTemporalInput): boolean => i.recurrenceRule === null

const templateWithPeriodDates = (i: GoalTemporalInput): boolean =>
  i.parentGoalId === null && hasPeriodDates(i)

const instanceWithMissingPeriod = (i: GoalTemporalInput): boolean =>
  i.parentGoalId !== null && periodMissing(i)

const instanceWithInvertedPeriod = (i: GoalTemporalInput): boolean =>
  i.parentGoalId !== null && periodInverted(i)

// ── The table ───────────────────────────────────────────────────

export type GoalTypeRule = Readonly<{
  /** Rule name — its role in the decision table. */
  name: string
  when: (input: GoalTemporalInput) => boolean
  code: GoalErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

// Exported (read-only) as the declared oracle for the BQC-6.9 property tests —
// the first-match-wins invariant is verified against this exact table.
export const GOAL_TYPE_RULES: Readonly<Record<GoalType, ReadonlyArray<GoalTypeRule>>> = {
  open: [
    {
      name: 'period-forbidden',
      when: hasPeriodDates,
      code: 'period_not_allowed',
      message: 'Period not allowed for open goals',
      context: { goalType: 'open' },
    },
    {
      name: 'rolling-window-forbidden',
      when: hasRollingWindow,
      code: 'rolling_window_not_allowed',
      message: 'Rolling window not allowed for open goals',
      context: { goalType: 'open' },
    },
    {
      name: 'recurrence-rule-forbidden',
      when: hasRecurrenceRule,
      code: 'recurrence_rule_not_allowed',
      message: 'Recurrence rule not allowed for open goals',
      context: { goalType: 'open' },
    },
  ],
  one_shot: [
    {
      name: 'period-required',
      when: periodMissing,
      code: 'period_required',
      message: 'Period required for one-shot goals',
      context: { goalType: 'one_shot' },
    },
    {
      name: 'period-ordered',
      when: periodInverted,
      code: 'invalid_period',
      message: 'periodEnd must be after periodStart',
    },
    {
      name: 'rolling-window-forbidden',
      when: hasRollingWindow,
      code: 'rolling_window_not_allowed',
      message: 'Rolling window not allowed for one-shot goals',
      context: { goalType: 'one_shot' },
    },
    {
      name: 'recurrence-rule-forbidden',
      when: hasRecurrenceRule,
      code: 'recurrence_rule_not_allowed',
      message: 'Recurrence rule not allowed for one-shot goals',
      context: { goalType: 'one_shot' },
    },
  ],
  rolling: [
    {
      name: 'rolling-window-required',
      when: rollingWindowMissingOrNonPositive,
      code: 'rolling_window_required',
      message: 'Rolling window required for rolling goals',
    },
    {
      name: 'period-forbidden',
      when: hasPeriodDates,
      code: 'period_not_allowed',
      message: 'Period not allowed for rolling goals',
      context: { goalType: 'rolling' },
    },
    {
      name: 'recurrence-rule-forbidden',
      when: hasRecurrenceRule,
      code: 'recurrence_rule_not_allowed',
      message: 'Recurrence rule not allowed for rolling goals',
      context: { goalType: 'rolling' },
    },
  ],
  recurring: [
    {
      name: 'recurrence-rule-required',
      when: recurrenceRuleMissing,
      code: 'recurrence_rule_required',
      message: 'Recurrence rule required for recurring goals',
    },
    {
      name: 'template-period-forbidden',
      when: templateWithPeriodDates,
      code: 'period_not_allowed',
      message: 'Period not allowed for recurring templates',
      context: { goalType: 'recurring' },
    },
    {
      name: 'instance-period-required',
      when: instanceWithMissingPeriod,
      code: 'period_required',
      message: 'Period required for recurring instances',
      context: { goalType: 'recurring' },
    },
    {
      name: 'instance-period-ordered',
      when: instanceWithInvertedPeriod,
      code: 'invalid_period',
      message: 'periodEnd must be after periodStart',
    },
    {
      name: 'rolling-window-forbidden',
      when: hasRollingWindow,
      code: 'rolling_window_not_allowed',
      message: 'Rolling window not allowed for recurring goals',
      context: { goalType: 'recurring' },
    },
  ],
}

/**
 * Evaluate the decision table for the goal's temporal fields.
 * Returns the first matching rule's violation, or null when the input is valid.
 */
export function firstGoalTypeRuleViolation(input: GoalTemporalInput): GoalError | null {
  const rules = GOAL_TYPE_RULES[input.goalType]
  if (!rules) {
    // Unreachable in typed code — preserves the original switch's assertNever guard.
    assertNever('goalType', input.goalType as never)
  }
  for (const rule of rules) {
    if (rule.when(input)) {
      return goalError(rule.code, rule.message, rule.context)
    }
  }
  return null
}
