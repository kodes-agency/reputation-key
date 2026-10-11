import { describe, expect, it } from 'vitest'
import { createGoalsForSubjectsSchema } from './goal-bulk-create.dto'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000001'
const portal = (index: number) => ({
  kind: 'portal' as const,
  portalId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
})
const group = {
  kind: 'portal_group' as const,
  portalGroupId: '00000000-0000-4000-8000-0000000000aa',
}
const save = (patch: Record<string, unknown> = {}) => ({
  propertyId: PROPERTY_ID,
  metric: 'portal_rating_count',
  startMonth: '2026-10',
  items: [
    { subject: portal(1), targetValue: 40 },
    { subject: group, targetValue: 120 },
  ],
  ...patch,
})
const accepts = (input: unknown) => createGoalsForSubjectsSchema.safeParse(input).success

describe('the save of goals for several subjects, as it arrives', () => {
  it('takes one target per Portal or Portal Group, a measure and a month', () => {
    expect(createGoalsForSubjectsSchema.parse(save())).toEqual(save())
  })

  it('takes no row for the Property as a whole', () => {
    const property = { kind: 'property', propertyId: PROPERTY_ID }

    expect(accepts(save({ items: [{ subject: property, targetValue: 40 }] }))).toBe(false)
  })

  it('takes from one row to 50', () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        subject: portal(index + 1),
        targetValue: 10,
      }))

    expect(accepts(save({ items: [] }))).toBe(false)
    expect(accepts(save({ items: rows(1) }))).toBe(true)
    expect(accepts(save({ items: rows(50) }))).toBe(true)
    expect(accepts(save({ items: rows(51) }))).toBe(false)
  })

  it('needs its month, as a calendar month key', () => {
    const { startMonth: _startMonth, ...withoutMonth } = save()

    expect(accepts(withoutMonth)).toBe(false)
    for (const invalid of ['2026-13', '2026-00', '2026-1', 'next', '']) {
      expect(accepts(save({ startMonth: invalid }))).toBe(false)
    }
  })

  it('takes a known measure and subjects that are ids', () => {
    expect(accepts(save({ metric: 'google_rating' }))).toBe(false)
    expect(
      accepts(
        save({
          items: [{ subject: { kind: 'portal', portalId: 'lobby' }, targetValue: 40 }],
        }),
      ),
    ).toBe(false)
  })

  // Whether a number suits the measure is decided per row by the command, so
  // one wrong target is reported for its row and the other rows are saved.
  it('takes any finite number as a target and leaves the measure’s rule to the command', () => {
    const withTarget = (targetValue: unknown) =>
      accepts(save({ items: [{ subject: portal(1), targetValue }] }))

    expect(withTarget(1.5)).toBe(true)
    expect(withTarget(0)).toBe(true)
    expect(withTarget(Number.POSITIVE_INFINITY)).toBe(false)
    expect(withTarget(Number.NaN)).toBe(false)
    expect(withTarget('40')).toBe(false)
  })
})
