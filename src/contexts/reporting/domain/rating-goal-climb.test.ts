import { describe, expect, it } from 'vitest'
import { initialPlan, perMonthOf28Days } from './rating-goal-climb'

describe('perMonthOf28Days', () => {
  it('turns four weeks of reviews into a whole number a month, half up', () => {
    expect(perMonthOf28Days(2)).toBe(2)
    expect(perMonthOf28Days(7)).toBe(8)
    expect(perMonthOf28Days(13)).toBe(14)
    expect(perMonthOf28Days(0)).toBe(0)
  })
})

describe('initialPlan', () => {
  const current = { targetTenths: 42, paceTenthsPerWeek: 140 }

  it('is the plan as it stands when nothing changed', () => {
    expect(initialPlan(current, [])).toEqual(current)
  })

  it('takes each field’s first old value', () => {
    expect(
      initialPlan(current, [
        { field: 'target', oldValue: '41' },
        { field: 'pace', oldValue: '70' },
      ]),
    ).toEqual({ targetTenths: 41, paceTenthsPerWeek: 70 })
  })

  it('has no pace when the goal was set to keep a number', () => {
    expect(
      initialPlan(current, [
        { field: 'mode', oldValue: 'keep' },
        { field: 'pace', oldValue: null },
      ]),
    ).toEqual({ targetTenths: 42, paceTenthsPerWeek: null })
  })

  it('keeps the target it has when a logged one is unreadable', () => {
    expect(initialPlan(current, [{ field: 'target', oldValue: 'x' }])).toEqual(current)
  })
})
