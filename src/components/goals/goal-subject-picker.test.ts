import { describe, expect, it } from 'vitest'
import {
  goalSubjectKey,
  goalSubjectsFromKeys,
  type GoalSubjectKey,
} from './goal-subject-picker'

describe('Goal Program subject command mapping', () => {
  it('round-trips every canonical subject kind without losing standalone portals', () => {
    const keys: GoalSubjectKey[] = [
      'property:property-1',
      'portal_group:group-1',
      'portal:portal-with-no-group',
    ]

    const subjects = goalSubjectsFromKeys(keys)

    expect(subjects).toEqual([
      { kind: 'property', propertyId: 'property-1' },
      { kind: 'portal_group', portalGroupId: 'group-1' },
      { kind: 'portal', portalId: 'portal-with-no-group' },
    ])
    expect(subjects.map(goalSubjectKey)).toEqual(keys)
  })
})
