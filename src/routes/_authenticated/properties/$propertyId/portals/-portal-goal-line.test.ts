import { describe, expect, it } from 'vitest'
import { portalGoalLineShown } from './-portal-goal-line'

// A Portal's Results line is read only on the Results tab, for someone who may
// set the Monthly portal goal, with Goals and Results on, and never for a draft
// Portal (PLAN PG-16, §3.5).

const everything = {
  can: (permission: string) => permission === 'goal.create',
  has: (capability: string) =>
    capability === 'goal.use' || capability === 'dashboard.use',
}

describe('portalGoalLineShown', () => {
  it('the Results tab of a published or a disabled Portal, for a manager: read', () => {
    expect(portalGoalLineShown(true, 'published', everything)).toBe(true)
    expect(portalGoalLineShown(true, 'disabled', everything)).toBe(true)
  })

  it('a draft Portal has no line', () => {
    expect(portalGoalLineShown(true, 'draft', everything)).toBe(false)
  })

  it('another tab reads nothing', () => {
    expect(portalGoalLineShown(false, 'published', everything)).toBe(false)
  })

  it('without goal.create, with Goals off, or with Results off: no read', () => {
    const asked: string[] = []
    const noCreate = {
      ...everything,
      can: (permission: string) => {
        asked.push(permission)
        return false
      },
    }
    const goalsOff = {
      ...everything,
      has: (capability: string) => capability !== 'goal.use',
    }
    const resultsOff = {
      ...everything,
      has: (capability: string) => capability !== 'dashboard.use',
    }

    expect(portalGoalLineShown(true, 'published', noCreate)).toBe(false)
    expect(asked).toEqual(['goal.create'])
    expect(portalGoalLineShown(true, 'published', goalsOff)).toBe(false)
    expect(portalGoalLineShown(true, 'published', resultsOff)).toBe(false)
  })
})
