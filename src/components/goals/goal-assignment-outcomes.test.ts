// A change of subjects starts with a whole month in the zone its version was
// cut in (the month after the one still counting, or the goal's own start month
// while it has not started): `effectiveFrom` is that month's first instant,
// which is still the previous day in UTC and further west. Printed in the
// viewer's own zone, a manager in New York read "Sep 30" for a Sofia Property
// whose change starts on 1 October, the date the Goal Program actually uses.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GoalAssignmentOutcomes } from './goal-assignment-outcomes'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GoalAssignmentOutcomes', () => {
  const render = (now: Date, effectiveFrom: Date | null) =>
    renderToStaticMarkup(
      createElement(GoalAssignmentOutcomes, {
        outcomes: [],
        effectiveFrom,
        propertyTimezone: 'Europe/Sofia',
        now,
        subjectLabel: () => 'Front desk QR',
      }),
    )
  const SOFIA_OCTOBER = new Date('2026-09-30T21:00:00.000Z')

  it('dates the saved change in the Property timezone, wherever the viewer is', () => {
    vi.stubEnv('TZ', 'America/New_York')

    const markup = render(new Date('2026-09-12T10:00:00.000Z'), SOFIA_OCTOBER)

    // The same receipt, and the same date rule, as the revision dialog.
    expect(markup).toContain('Change saved. Applies from Oct 1 (Europe/Sofia).')
    expect(markup).not.toContain('Scheduled from')
  })

  it('prints the year of a start outside the current one', () => {
    const markup = render(new Date('2027-01-05T10:00:00.000Z'), SOFIA_OCTOBER)

    expect(markup).toContain('Change saved. Applies from Oct 1, 2026 (Europe/Sofia).')
  })

  it('says nothing about a start when no change was saved', () => {
    const markup = render(new Date('2026-09-12T10:00:00.000Z'), null)

    expect(markup).not.toContain('Change saved')
  })
})
