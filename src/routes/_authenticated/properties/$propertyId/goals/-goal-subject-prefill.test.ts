import { describe, expect, it } from 'vitest'
import { prefilledGoalSubjects } from './-goal-subject-prefill'

const known = {
  groupIds: ['group-1', 'group-2'],
  portalIds: ['portal-1'],
}

// A group's page links to "Add a portal goal" with the group already chosen, so the
// goal is set where the manager was looking. A value that does not name one of
// this property's own subjects is ignored, never trusted.
describe('prefilledGoalSubjects', () => {
  it('chooses the group a link names', () => {
    expect(prefilledGoalSubjects('portal_group:group-2', known)).toEqual([
      { kind: 'portal_group', portalGroupId: 'group-2' },
    ])
  })

  it('chooses a portal the same way', () => {
    expect(prefilledGoalSubjects('portal:portal-1', known)).toEqual([
      { kind: 'portal', portalId: 'portal-1' },
    ])
  })

  // The Property's own goal is the Monthly portal goal, set from its card on
  // the Goals page (ADR 0068): this form makes a goal for a Portal or a group.
  it('no longer prefills the whole property', () => {
    expect(prefilledGoalSubjects('property:property-1', known)).toEqual([])
  })

  it.each([
    ['nothing', undefined],
    ['a group of another property', 'portal_group:group-9'],
    ['a kind that does not exist', 'organization:group-1'],
    ['no id', 'portal_group:'],
    ['text with no kind', 'group-1'],
    ['more than one subject', 'portal_group:group-1:portal_group:group-2'],
  ])('chooses nothing for %s', (_label, raw) => {
    expect(prefilledGoalSubjects(raw, known)).toEqual([])
  })
})
