// Goal-type decision-table tests — table-driven coverage of the temporal
// validation rules behind buildGoal (moved from constructors.test.ts).
// Error codes AND messages are pinned exactly — no behavior change.

import { describe, it, expect } from 'vitest'
import { firstGoalTypeRuleViolation, type GoalTemporalInput } from './goal-type-rules'
import { UnreachableError } from '#/shared/domain/assert'
import type { GoalErrorCode } from './errors'
import type { GoalType } from './types'
import { goalId } from '#/shared/domain/ids'

const D_START = new Date('2026-06-01')
const D_END = new Date('2026-06-30')

const BASE = {
  periodStart: null as Date | null,
  periodEnd: null as Date | null,
  recurrenceRule: null as { frequency: 'monthly' } | null,
  rollingWindowDays: null as number | null,
  parentGoalId: null as ReturnType<typeof goalId> | null,
}

const MONTHLY = { frequency: 'monthly' } as const

type Case = Readonly<{
  name: string
  input: Readonly<Partial<GoalTemporalInput>> & { goalType: GoalType }
  expectedCode: GoalErrorCode | null
  expectedMessage?: string
}>

// ── The decision table ──────────────────────────────────────────
//
//   goalType   periodStart/End                       rollingWindowDays   recurrenceRule   parentGoalId
//   open       forbidden                              forbidden           forbidden        —
//   one_shot   required, end after start              forbidden           forbidden        —
//   rolling    forbidden                              required, > 0       forbidden        —
//   recurring  template: forbidden;                   forbidden           required         template ↔
//              instance: required, end after start                                         instance switch

const CASES: ReadonlyArray<Case> = [
  // ── open ──
  {
    name: 'open: valid with no temporal fields',
    input: { goalType: 'open' },
    expectedCode: null,
  },
  {
    name: 'open: period dates rejected',
    input: { goalType: 'open', periodStart: D_START, periodEnd: D_END },
    expectedCode: 'period_not_allowed',
    expectedMessage: 'Period not allowed for open goals',
  },
  {
    name: 'open: rollingWindowDays rejected',
    input: { goalType: 'open', rollingWindowDays: 30 },
    expectedCode: 'rolling_window_not_allowed',
    expectedMessage: 'Rolling window not allowed for open goals',
  },
  {
    name: 'open: recurrenceRule rejected',
    input: { goalType: 'open', recurrenceRule: MONTHLY },
    expectedCode: 'recurrence_rule_not_allowed',
    expectedMessage: 'Recurrence rule not allowed for open goals',
  },
  {
    name: 'open: period violation wins over rolling-window violation (rule order)',
    input: { goalType: 'open', periodStart: D_START, rollingWindowDays: 30 },
    expectedCode: 'period_not_allowed',
  },

  // ── one_shot ──
  {
    name: 'one_shot: valid with an ordered period',
    input: { goalType: 'one_shot', periodStart: D_START, periodEnd: D_END },
    expectedCode: null,
  },
  {
    name: 'one_shot: missing period rejected',
    input: { goalType: 'one_shot' },
    expectedCode: 'period_required',
    expectedMessage: 'Period required for one-shot goals',
  },
  {
    name: 'one_shot: missing periodEnd rejected',
    input: { goalType: 'one_shot', periodStart: D_START },
    expectedCode: 'period_required',
  },
  {
    name: 'one_shot: inverted period rejected',
    input: { goalType: 'one_shot', periodStart: D_END, periodEnd: D_START },
    expectedCode: 'invalid_period',
    expectedMessage: 'periodEnd must be after periodStart',
  },
  {
    name: 'one_shot: rollingWindowDays rejected',
    input: {
      goalType: 'one_shot',
      periodStart: D_START,
      periodEnd: D_END,
      rollingWindowDays: 30,
    },
    expectedCode: 'rolling_window_not_allowed',
    expectedMessage: 'Rolling window not allowed for one-shot goals',
  },
  {
    name: 'one_shot: recurrenceRule rejected',
    input: {
      goalType: 'one_shot',
      periodStart: D_START,
      periodEnd: D_END,
      recurrenceRule: MONTHLY,
    },
    expectedCode: 'recurrence_rule_not_allowed',
    expectedMessage: 'Recurrence rule not allowed for one-shot goals',
  },
  {
    name: 'one_shot: missing period wins over rolling-window violation (rule order)',
    input: { goalType: 'one_shot', rollingWindowDays: 30 },
    expectedCode: 'period_required',
  },

  // ── rolling ──
  {
    name: 'rolling: valid with a positive window',
    input: { goalType: 'rolling', rollingWindowDays: 30 },
    expectedCode: null,
  },
  {
    name: 'rolling: missing window rejected',
    input: { goalType: 'rolling' },
    expectedCode: 'rolling_window_required',
    expectedMessage: 'Rolling window required for rolling goals',
  },
  {
    name: 'rolling: zero window rejected',
    input: { goalType: 'rolling', rollingWindowDays: 0 },
    expectedCode: 'rolling_window_required',
  },
  {
    name: 'rolling: negative window rejected',
    input: { goalType: 'rolling', rollingWindowDays: -5 },
    expectedCode: 'rolling_window_required',
  },
  {
    name: 'rolling: period dates rejected',
    input: {
      goalType: 'rolling',
      rollingWindowDays: 30,
      periodStart: D_START,
      periodEnd: D_END,
    },
    expectedCode: 'period_not_allowed',
    expectedMessage: 'Period not allowed for rolling goals',
  },
  {
    name: 'rolling: recurrenceRule rejected',
    input: { goalType: 'rolling', rollingWindowDays: 30, recurrenceRule: MONTHLY },
    expectedCode: 'recurrence_rule_not_allowed',
    expectedMessage: 'Recurrence rule not allowed for rolling goals',
  },

  // ── recurring (template) ──
  {
    name: 'recurring template: valid with a recurrence rule',
    input: { goalType: 'recurring', recurrenceRule: MONTHLY },
    expectedCode: null,
  },
  {
    name: 'recurring template: missing recurrence rule rejected',
    input: { goalType: 'recurring' },
    expectedCode: 'recurrence_rule_required',
    expectedMessage: 'Recurrence rule required for recurring goals',
  },
  {
    name: 'recurring template: period dates rejected',
    input: {
      goalType: 'recurring',
      recurrenceRule: MONTHLY,
      periodStart: D_START,
      periodEnd: D_END,
    },
    expectedCode: 'period_not_allowed',
    expectedMessage: 'Period not allowed for recurring templates',
  },
  {
    name: 'recurring template: rollingWindowDays rejected',
    input: { goalType: 'recurring', recurrenceRule: MONTHLY, rollingWindowDays: 30 },
    expectedCode: 'rolling_window_not_allowed',
    expectedMessage: 'Rolling window not allowed for recurring goals',
  },
  {
    name: 'recurring: missing rule wins over template period violation (rule order)',
    input: { goalType: 'recurring', periodStart: D_START, periodEnd: D_END },
    expectedCode: 'recurrence_rule_required',
  },

  // ── recurring (instance) ──
  {
    name: 'recurring instance: valid with an ordered period',
    input: {
      goalType: 'recurring',
      recurrenceRule: MONTHLY,
      parentGoalId: goalId('parent-1'),
      periodStart: D_START,
      periodEnd: D_END,
    },
    expectedCode: null,
  },
  {
    name: 'recurring instance: missing period rejected',
    input: {
      goalType: 'recurring',
      recurrenceRule: MONTHLY,
      parentGoalId: goalId('parent-1'),
    },
    expectedCode: 'period_required',
    expectedMessage: 'Period required for recurring instances',
  },
  {
    name: 'recurring instance: inverted period rejected',
    input: {
      goalType: 'recurring',
      recurrenceRule: MONTHLY,
      parentGoalId: goalId('parent-1'),
      periodStart: D_END,
      periodEnd: D_START,
    },
    expectedCode: 'invalid_period',
    expectedMessage: 'periodEnd must be after periodStart',
  },
]

describe('firstGoalTypeRuleViolation (goal-type decision table)', () => {
  it.each(CASES)('$name', ({ input, expectedCode, expectedMessage }) => {
    const violation = firstGoalTypeRuleViolation({ ...BASE, ...input })

    if (expectedCode === null) {
      expect(violation).toBeNull()
      return
    }
    expect(violation?.code).toBe(expectedCode)
    if (expectedMessage) {
      expect(violation?.message).toBe(expectedMessage)
    }
  })

  it('carries the goalType context on per-type violations', () => {
    const violation = firstGoalTypeRuleViolation({
      ...BASE,
      goalType: 'open',
      periodStart: D_START,
    })
    expect(violation?.context).toEqual({ goalType: 'open' })
  })

  it('carries no context on type-agnostic violations (invalid_period)', () => {
    const violation = firstGoalTypeRuleViolation({
      ...BASE,
      goalType: 'one_shot',
      periodStart: D_END,
      periodEnd: D_START,
    })
    expect(violation?.context).toBeUndefined()
  })

  it('throws UnreachableError for an untypable goalType (assertNever guard)', () => {
    // The table lookup misses only when a value bypasses the GoalType union
    // (e.g. an unvalidated DB row) — the guard must fail loudly.
    expect(() =>
      firstGoalTypeRuleViolation({ ...BASE, goalType: 'fortnightly' as GoalType }),
    ).toThrowError(UnreachableError)
  })
})
