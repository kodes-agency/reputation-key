// A route spells its own page title when importing the feature's constant would
// put the feature's dependencies on the route row, in first paint. These copies
// must agree with the feature, which uses the title for the tab and fallbacks.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PORTAL_GOAL_RESULTS_TITLE } from '#/contexts/reporting/monthly-goals/ui/portal-goal-results-view'

describe('route title copies', () => {
  it('names the portal goal results page as the feature does', () => {
    const route = readFileSync(
      join(
        process.cwd(),
        'src/routes/_authenticated/properties/$propertyId/goals/portal-results.tsx',
      ),
      'utf8',
    )

    expect(route).toContain(`const TITLE = '${PORTAL_GOAL_RESULTS_TITLE}'`)
  })
})
