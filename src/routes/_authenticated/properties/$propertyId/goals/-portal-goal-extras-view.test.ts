import { describe, expect, it } from 'vitest'
import type { GoalSubject } from '#/contexts/reporting/application/public-api'
import { extrasRows } from './-portal-goal-extras-view'

const reception: GoalSubject = { kind: 'portal', portalId: 'portal-reception' }
const rooms: GoalSubject = { kind: 'portal_group', portalGroupId: 'group-rooms' }
const property: GoalSubject = { kind: 'property', propertyId: 'property-1' }

/** A goal of `metric` for `subjects` now. */
const goal = (
  id: string,
  subjects: readonly GoalSubject[],
  metric:
    | 'portal_rating_count'
    | 'qualified_scans'
    | 'portal_rating_average' = 'portal_rating_count',
) => ({
  program: { id, status: 'active' as const },
  version: { id: `${id}-v2`, metric },
  assignments: [
    // A window of an earlier version is not whom the goal counts now.
    {
      programVersionId: `${id}-v1`,
      subject: { kind: 'portal', portalId: 'old' } as const,
    },
    ...subjects.map((subject) => ({ programVersionId: `${id}-v2`, subject })),
  ],
})

const NAMES: Readonly<Record<string, string>> = {
  'portal:portal-reception': 'Reception',
  'portal_group:group-rooms': 'Rooms',
}
const subjectName = (subject: GoalSubject): string =>
  subject.kind === 'portal'
    ? (NAMES[`portal:${subject.portalId}`] ?? 'Portal')
    : subject.kind === 'portal_group'
      ? (NAMES[`portal_group:${subject.portalGroupId}`] ?? 'Group')
      : 'Seaview Hotel'

describe('the other portal goals as compact rows (PG-21)', () => {
  it('names whom each goal counts and what; the average by its measure alone', () => {
    const { rows } = extrasRows(
      [
        goal('reception', [reception]),
        goal('rooms', [rooms], 'qualified_scans'),
        goal('average', [property], 'portal_rating_average'),
      ],
      { monthlyGoalId: null, subjectName },
    )

    expect(rows.map(({ goal: { program }, name }) => [program.id, name])).toEqual([
      ['reception', 'Reception · Private ratings'],
      ['rooms', 'Rooms (group) · Scans'],
      ['average', 'Average private rating'],
    ])
  })

  it('leaves out the goal the card shows', () => {
    const { rows } = extrasRows(
      [goal('monthly', [property]), goal('reception', [reception])],
      {
        monthlyGoalId: 'monthly',
        subjectName,
      },
    )

    expect(rows.map(({ goal: { program } }) => program.id)).toEqual(['reception'])
  })

  it('the Goals page lists the first 5, then says there are more', () => {
    const seven = Array.from({ length: 7 }, (_, index) =>
      goal(`goal-${index}`, [reception]),
    )

    const limited = extrasRows(seven, { monthlyGoalId: null, subjectName, limit: 5 })
    const all = extrasRows(seven, { monthlyGoalId: null, subjectName })
    const five = extrasRows(seven.slice(0, 5), {
      monthlyGoalId: null,
      subjectName,
      limit: 5,
    })

    expect(limited.rows).toHaveLength(5)
    expect(limited.more).toBe(true)
    expect(all.rows).toHaveLength(7)
    expect(all.more).toBe(false)
    expect(five.more).toBe(false)
  })
})
