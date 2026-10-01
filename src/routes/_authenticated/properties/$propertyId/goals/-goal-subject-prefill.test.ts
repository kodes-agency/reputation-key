import { describe, expect, it } from 'vitest'
import { prefilledGoalSubjects } from './-goal-subject-prefill'

const known = {
  propertyId: 'property-1',
  groupIds: ['group-1', 'group-2'],
  portalIds: ['portal-1'],
}

// A group's page links to "New goal" with the group already chosen, so the
// goal is set where the manager was looking. A value that does not name one of
// this property's own subjects is ignored, never trusted.
describe('prefilledGoalSubjects', () => {
  it('chooses the group a link names', () => {
    expect(prefilledGoalSubjects('portal_group:group-2', known)).toEqual([
      { kind: 'portal_group', portalGroupId: 'group-2' },
    ])
  })

  it('chooses a portal or the property the same way', () => {
    expect(prefilledGoalSubjects('portal:portal-1', known)).toEqual([
      { kind: 'portal', portalId: 'portal-1' },
    ])
    expect(prefilledGoalSubjects('property:property-1', known)).toEqual([
      { kind: 'property', propertyId: 'property-1' },
    ])
  })

  it.each([
    ['nothing', undefined],
    ['a group of another property', 'portal_group:group-9'],
    ['another property', 'property:property-2'],
    ['a kind that does not exist', 'organization:group-1'],
    ['no id', 'portal_group:'],
    ['text with no kind', 'group-1'],
    ['more than one subject', 'portal_group:group-1:portal_group:group-2'],
  ])('chooses nothing for %s', (_label, raw) => {
    expect(prefilledGoalSubjects(raw, known)).toEqual([])
  })
})
