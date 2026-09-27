import { describe, expect, it } from 'vitest'
import { goalSubjectIdentity, type GoalSubject } from '../domain/goal-program'
import {
  classifySelections,
  resolveAssignmentOutcomes,
  type ClassifiedSelection,
} from './goal-assignment-selection'

const portal = (portalId: string): GoalSubject => ({ kind: 'portal', portalId })
const group = (portalGroupId: string): GoalSubject => ({
  kind: 'portal_group',
  portalGroupId,
})
const byIdentity = (...subjects: GoalSubject[]) =>
  new Map(subjects.map((subject) => [goalSubjectIdentity(subject), subject]))

const selection = (
  operation: ClassifiedSelection['operation'],
  subject: GoalSubject,
  outcome: ClassifiedSelection['outcome'] = null,
): ClassifiedSelection => ({
  operation,
  source: 'explicit',
  subject,
  identity: goalSubjectIdentity(subject),
  outcome,
})

describe('classifySelections', () => {
  it('orders explicit adds, the current-Portal snapshot, then removes', () => {
    const selections = classifySelections({
      add: [group('group-1')],
      remove: [portal('portal-9')],
      currentPortalIds: ['portal-1'],
    })

    expect(selections).toEqual([
      {
        operation: 'add',
        source: 'explicit',
        subject: group('group-1'),
        identity: 'portal_group:group-1',
        outcome: null,
      },
      {
        operation: 'add',
        source: 'all_current_portals',
        subject: portal('portal-1'),
        identity: 'portal:portal-1',
        outcome: null,
      },
      {
        operation: 'remove',
        source: 'explicit',
        subject: portal('portal-9'),
        identity: 'portal:portal-9',
        outcome: null,
      },
    ])
  })

  it('marks a repeat of the same operation a duplicate after its first occurrence', () => {
    const selections = classifySelections({
      add: [portal('portal-1'), portal('portal-1')],
      remove: [],
      currentPortalIds: ['portal-1'],
    })

    expect(selections.map(({ source, outcome }) => ({ source, outcome }))).toEqual([
      { source: 'explicit', outcome: null },
      { source: 'explicit', outcome: 'duplicate' },
      { source: 'all_current_portals', outcome: 'duplicate' },
    ])
  })

  it('marks every selection of a subject both added and removed as conflicting', () => {
    const selections = classifySelections({
      add: [portal('portal-1')],
      remove: [portal('portal-1'), portal('portal-1'), portal('portal-2')],
      currentPortalIds: ['portal-1'],
    })

    expect(selections.map(({ identity, outcome }) => ({ identity, outcome }))).toEqual([
      { identity: 'portal:portal-1', outcome: 'conflicting_operations' },
      { identity: 'portal:portal-1', outcome: 'conflicting_operations' },
      { identity: 'portal:portal-1', outcome: 'conflicting_operations' },
      { identity: 'portal:portal-1', outcome: 'conflicting_operations' },
      { identity: 'portal:portal-2', outcome: null },
    ])
  })
})

describe('resolveAssignmentOutcomes', () => {
  it('adds and removes against the current set, keeping its order', () => {
    const current = byIdentity(portal('portal-1'), portal('portal-2'))

    const resolved = resolveAssignmentOutcomes({
      selections: [
        selection('add', portal('portal-3')),
        selection('remove', portal('portal-1')),
      ],
      ownership: [true, true],
      currentByIdentity: current,
      overlapping: new Set(),
    })

    expect(resolved.outcomes.map(({ outcome }) => outcome)).toEqual(['added', 'removed'])
    expect([...resolved.nextByIdentity.keys()]).toEqual([
      'portal:portal-2',
      'portal:portal-3',
    ])
    expect(resolved.changed).toBe(true)
    expect([...current.keys()]).toEqual(['portal:portal-1', 'portal:portal-2'])
  })

  it('reports each refusal without changing the assignment set', () => {
    const current = byIdentity(portal('portal-1'))

    const resolved = resolveAssignmentOutcomes({
      selections: [
        selection('add', portal('portal-1')),
        selection('remove', portal('portal-2')),
        selection('add', portal('portal-3')),
        selection('add', portal('portal-4')),
        selection('add', portal('portal-5'), 'duplicate'),
        selection('remove', portal('portal-6'), 'conflicting_operations'),
      ],
      ownership: [true, true, false, true, false, true],
      currentByIdentity: current,
      overlapping: new Set(['portal:portal-4']),
    })

    expect(resolved.outcomes.map(({ outcome }) => outcome)).toEqual([
      'already_assigned',
      'not_assigned',
      'invalid_subject',
      'overlap',
      'duplicate',
      'conflicting_operations',
    ])
    expect([...resolved.nextByIdentity.keys()]).toEqual(['portal:portal-1'])
    expect(resolved.changed).toBe(false)
  })

  it('refuses a change that would leave no assignment', () => {
    const resolved = resolveAssignmentOutcomes({
      selections: [
        selection('remove', portal('portal-1')),
        selection('remove', portal('portal-2')),
        selection('add', portal('portal-3')),
      ],
      ownership: [true, true, false],
      currentByIdentity: byIdentity(portal('portal-1'), portal('portal-2')),
      overlapping: new Set(),
    })

    expect(resolved.outcomes).toEqual([
      {
        operation: 'remove',
        source: 'explicit',
        subject: portal('portal-1'),
        outcome: 'last_assignment_required',
      },
      {
        operation: 'remove',
        source: 'explicit',
        subject: portal('portal-2'),
        outcome: 'last_assignment_required',
      },
      {
        operation: 'add',
        source: 'explicit',
        subject: portal('portal-3'),
        outcome: 'invalid_subject',
      },
    ])
    expect(resolved.changed).toBe(false)
  })
})
