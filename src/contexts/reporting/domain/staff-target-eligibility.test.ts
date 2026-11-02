import { it, expect } from 'vitest'
import { staffTargetProblem, STAFF_TARGET_MESSAGES } from './staff-target-eligibility'
it('only admits enabled scans for personal subjects with every rating collector on', () => {
  const person = { kind: 'personal', skipPrivateRating: false }
  expect(staffTargetProblem([person], 'qualified_scans', true)).toBeNull()
  expect(staffTargetProblem([person], 'portal_rating_count', true)).toBe(
    'staff_scan_only',
  )
  expect(staffTargetProblem([person], 'portal_rating_average', true)).toBe(
    'staff_scan_only',
  )
  expect(staffTargetProblem([person], 'qualified_scans', false)).toBe(
    'staff_scan_targets_disabled',
  )
  expect(
    staffTargetProblem(
      [person, { kind: 'place', skipPrivateRating: true }],
      'qualified_scans',
      true,
    ),
  ).toBe('staff_private_ratings_skipped')
  expect(STAFF_TARGET_MESSAGES.staff_scan_only).toBe(
    'A target for staff can only count scans.',
  )
})
it('does not narrow ordinary place scan targets', () => {
  expect(
    staffTargetProblem(
      [{ kind: 'place', skipPrivateRating: true }],
      'qualified_scans',
      false,
    ),
  ).toBeNull()
})
