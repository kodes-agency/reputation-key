// An assignment change starts with the next full month in the Property's
// timezone: `effectiveFrom` is that month's first instant, which is still the
// previous day in UTC and further west. Printed in the viewer's own zone, a
// manager in New York read "Sep 30" for a Sofia Property whose change starts on
// 1 October — the date the Goal Program actually uses.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GoalAssignmentOutcomes } from './goal-assignment-outcomes'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GoalAssignmentOutcomes', () => {
  it('dates the scheduled change in the Property timezone, wherever the viewer is', () => {
    vi.stubEnv('TZ', 'America/New_York')

    const markup = renderToStaticMarkup(
      createElement(GoalAssignmentOutcomes, {
        outcomes: [],
        effectiveFrom: new Date('2026-09-30T21:00:00.000Z'),
        propertyTimezone: 'Europe/Sofia',
        subjectLabel: () => 'Front desk QR',
      }),
    )

    expect(markup).toContain('Scheduled from Oct 1, 2026 (Europe/Sofia).')
  })
})
