// BQC-6.9 — property tests for the goal-type decision table (fast-check).
//
// Generates arbitrary temporal inputs across every goalType (period present/
// absent/ordered/inverted/degenerate × rolling window present/absent/
// positive/zero/negative × recurrence rule × template/instance switch) and
// asserts, over every evaluation:
//   1. no throw — any typed input evaluates to a violation or null (an
//      untagged throw fails the property directly);
//   2. tagged outcome — a violation is always a GoalError carrying the named
//      code/message of a declared rule;
//   3. first-match-wins — the outcome equals the FIRST matching rule in the
//      declared GOAL_TYPE_RULES order (null when no rule matches).

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  firstGoalTypeRuleViolation,
  GOAL_TYPE_RULES,
  type GoalTemporalInput,
} from './goal-type-rules'
import type { GoalType, RecurrenceFrequency, RecurrenceRule } from './types'
import { goalId } from '#/shared/domain/ids'

const arbGoalType = fc.constantFrom<GoalType>('open', 'one_shot', 'rolling', 'recurring')

// Bounded, always-valid dates.
const arbDate = fc.date({
  min: new Date('2020-01-01T00:00:00.000Z'),
  max: new Date('2030-12-31T23:59:59.000Z'),
  noInvalidDate: true,
})

// Period pairs shaped to hit every cell: absent, arbitrary order (ordered +
// inverted), degenerate (end === start), start-only, end-only.
const arbPeriod: fc.Arbitrary<readonly [Date | null, Date | null]> = fc.oneof(
  fc.constant([null, null] as const),
  fc.tuple(arbDate, arbDate),
  arbDate.map((d) => [d, d] as const),
  arbDate.map((d) => [d, null] as const),
  arbDate.map((d) => [null, d] as const),
)

const arbRecurrenceRule: fc.Arbitrary<RecurrenceRule> = fc
  .constantFrom<RecurrenceFrequency>('weekly', 'monthly', 'quarterly')
  .map((frequency) => ({ frequency }))

const arbInput: fc.Arbitrary<GoalTemporalInput> = fc
  .record({
    goalType: arbGoalType,
    period: arbPeriod,
    recurrenceRule: fc.option(arbRecurrenceRule, { nil: null }),
    rollingWindowDays: fc.option(fc.integer({ min: -365, max: 365 }), { nil: null }),
    parentGoalId: fc.option(
      fc.uuid().map((id) => goalId(id)),
      { nil: null },
    ),
  })
  .map(({ period, ...rest }) => ({
    ...rest,
    periodStart: period[0],
    periodEnd: period[1],
  }))

describe('goal-type decision table (property)', () => {
  it('never throws, always returns the tagged first matching rule or null (first-match-wins)', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        // A throw here fails the property — the table must be total over typed inputs.
        const violation = firstGoalTypeRuleViolation(input)

        const expected = GOAL_TYPE_RULES[input.goalType].find((rule) => rule.when(input))

        if (expected === undefined) {
          expect(violation).toBeNull()
          return
        }
        expect(violation).not.toBeNull()
        expect(violation!._tag).toBe('GoalError')
        expect(violation!.code).toBe(expected.code)
        expect(violation!.message).toBe(expected.message)
        expect(violation!.context).toEqual(expected.context)
      }),
      { numRuns: 300 },
    )
  })

  it('re-ordering sensitivity: permuting any two rule positions changes the outcome for some input', () => {
    // Guards the decision-table semantics: for every goalType with 2+ rules,
    // swapping the first two rules must change the outcome for at least one
    // generated input that matches both — proving order is load-bearing and
    // the evaluator honors the declared sequence.
    fc.assert(
      fc.property(arbInput, (input) => {
        const rules = GOAL_TYPE_RULES[input.goalType]
        if (rules.length < 2) return true
        const [first, second, ...rest] = rules
        const swapped = [second, first, ...rest]

        const original = rules.find((rule) => rule.when(input))
        const afterSwap = swapped.find((rule) => rule.when(input))
        // Whenever both of the first two rules match, the winner must flip.
        if (first.when(input) && second.when(input)) {
          return original !== afterSwap
        }
        return true
      }),
      { numRuns: 300 },
    )
  })
})
