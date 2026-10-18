import { describe, expect, it } from 'vitest'
import { portalGoalPageSearchSchema } from './-portal-goal-page-search'

describe('portalGoalPageSearchSchema', () => {
  it('opens no sheet when the address asks for none', () => {
    expect(portalGoalPageSearchSchema.parse({})).toEqual({})
  })

  it('reads the add sheet step and its subject', () => {
    expect(
      portalGoalPageSearchSchema.parse({ add: 'portal', subject: 'portal:p1' }),
    ).toEqual({ add: 'portal', subject: 'portal:p1' })
    for (const add of ['choose', 'portal', 'each', 'group', 'average'] as const) {
      expect(portalGoalPageSearchSchema.parse({ add }).add).toBe(add)
    }
  })

  it('drops a step it does not know, and a subject too long to be one', () => {
    expect(portalGoalPageSearchSchema.parse({ add: 'several' })).toEqual({})
    expect(portalGoalPageSearchSchema.parse({ add: 3 })).toEqual({})
    expect(
      portalGoalPageSearchSchema.parse({ add: 'group', subject: 'x'.repeat(101) }),
    ).toEqual({ add: 'group' })
  })
})
