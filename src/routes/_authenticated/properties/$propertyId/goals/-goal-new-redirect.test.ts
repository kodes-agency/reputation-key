import { describe, expect, it } from 'vitest'
import { goalNewRedirect } from './-goal-new-redirect'

// The New goal page is gone (PLAN PG-20): its old addresses open "Add a portal
// goal" on the goal page, where the step they asked for is.
describe('goalNewRedirect', () => {
  it('maps each old address and drops unknown keys', () => {
    expect(goalNewRedirect({})).toEqual({ add: 'choose' })
    expect(goalNewRedirect({ mode: 'several' })).toEqual({ add: 'each' })
    expect(goalNewRedirect({ subject: 'portal:p1' })).toEqual({
      add: 'portal',
      subject: 'portal:p1',
    })
    expect(goalNewRedirect({ subject: 'portal_group:g1' })).toEqual({
      add: 'group',
      subject: 'portal_group:g1',
    })
    // The whole property's goal is the Monthly portal goal: the choice opens.
    expect(goalNewRedirect({ subject: 'property:x' })).toEqual({ add: 'choose' })
    expect(goalNewRedirect({ subject: 'portal:p1', view: 'one', extra: 1 })).toEqual({
      add: 'portal',
      subject: 'portal:p1',
    })
  })

  it('reads only what an old link could have said', () => {
    expect(goalNewRedirect({ mode: 'many' })).toEqual({ add: 'choose' })
    expect(goalNewRedirect({ subject: 7 })).toEqual({ add: 'choose' })
    expect(goalNewRedirect({ subject: 'portal:' })).toEqual({ add: 'choose' })
    expect(goalNewRedirect({ subject: `portal:${'x'.repeat(100)}` })).toEqual({
      add: 'choose',
    })
  })
})
