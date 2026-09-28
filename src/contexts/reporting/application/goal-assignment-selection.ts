// Reporting — the pure rules behind a Goal Program assignment change.
//
// changeAssignments turns a request's explicit adds and removes, plus an
// optional snapshot of every current Portal, into one outcome per selection
// and the next assignment set. Authorization, loading, the ownership and
// overlap lookups, and the revision stay in the use case; these functions
// decide the outcomes.

import { goalSubjectIdentity, type GoalSubject } from '../domain/goal-program'

export type GoalAssignmentChangeOutcomeCode =
  | 'added'
  | 'removed'
  | 'already_assigned'
  | 'not_assigned'
  | 'duplicate'
  | 'conflicting_operations'
  | 'invalid_subject'
  | 'overlap'
  | 'last_assignment_required'

export type GoalAssignmentChangeOutcome = Readonly<{
  operation: 'add' | 'remove'
  source: 'explicit' | 'all_current_portals'
  subject: GoalSubject
  outcome: GoalAssignmentChangeOutcomeCode
}>

/** A requested add or remove, with any outcome it earns before a lookup. */
export type ClassifiedSelection = Readonly<{
  operation: GoalAssignmentChangeOutcome['operation']
  source: GoalAssignmentChangeOutcome['source']
  subject: GoalSubject
  identity: string
  outcome: 'duplicate' | 'conflicting_operations' | null
}>

export type AssignmentOutcomes = Readonly<{
  outcomes: readonly GoalAssignmentChangeOutcome[]
  nextByIdentity: ReadonlyMap<string, GoalSubject>
  changed: boolean
}>

type RequestedSelection = Omit<ClassifiedSelection, 'outcome'>

const requested = (
  operation: RequestedSelection['operation'],
  source: RequestedSelection['source'],
  subject: GoalSubject,
): RequestedSelection => ({
  operation,
  source,
  subject,
  identity: goalSubjectIdentity(subject),
})

/**
 * Expand a request into selections in reporting order: explicit adds, the
 * current-Portal snapshot, then removes. A subject both added and removed is
 * conflicting wherever it appears; otherwise a repeat of the same operation on
 * the same subject is a duplicate after its first occurrence.
 */
export function classifySelections(
  input: Readonly<{
    add: readonly GoalSubject[]
    remove: readonly GoalSubject[]
    currentPortalIds: readonly string[]
  }>,
): readonly ClassifiedSelection[] {
  const selections = [
    ...input.add.map((subject) => requested('add', 'explicit', subject)),
    ...input.currentPortalIds.map((portalId) =>
      requested('add', 'all_current_portals', { kind: 'portal', portalId }),
    ),
    ...input.remove.map((subject) => requested('remove', 'explicit', subject)),
  ]
  const added = new Set(
    selections
      .filter((selection) => selection.operation === 'add')
      .map((selection) => selection.identity),
  )
  const conflicting = new Set(
    selections
      .filter((selection) => selection.operation === 'remove')
      .map((selection) => selection.identity)
      .filter((identity) => added.has(identity)),
  )
  const repeatsEarlier = (selection: RequestedSelection, index: number) =>
    selections
      .slice(0, index)
      .some(
        (earlier) =>
          earlier.operation === selection.operation &&
          earlier.identity === selection.identity,
      )

  return selections.map((selection, index) => ({
    ...selection,
    outcome: conflicting.has(selection.identity)
      ? 'conflicting_operations'
      : repeatsEarlier(selection, index)
        ? 'duplicate'
        : null,
  }))
}

function resolveSelection(
  state: AssignmentOutcomes,
  selection: ClassifiedSelection,
  owned: boolean | undefined,
  overlapping: ReadonlySet<string>,
): AssignmentOutcomes {
  /** Record the outcome; `next` is the assignment set when this selection changes it. */
  const settle = (
    outcome: GoalAssignmentChangeOutcomeCode,
    next?: ReadonlyMap<string, GoalSubject>,
  ): AssignmentOutcomes => ({
    outcomes: [
      ...state.outcomes,
      {
        operation: selection.operation,
        source: selection.source,
        subject: selection.subject,
        outcome,
      },
    ],
    nextByIdentity: next ?? state.nextByIdentity,
    changed: state.changed || next !== undefined,
  })

  if (selection.outcome) return settle(selection.outcome)
  if (!owned) return settle('invalid_subject')
  const assigned = state.nextByIdentity.has(selection.identity)
  if (selection.operation === 'add') {
    if (assigned) return settle('already_assigned')
    if (overlapping.has(selection.identity)) return settle('overlap')
    return settle(
      'added',
      new Map([...state.nextByIdentity, [selection.identity, selection.subject]]),
    )
  }
  if (!assigned) return settle('not_assigned')
  return settle(
    'removed',
    new Map(
      [...state.nextByIdentity].filter(([identity]) => identity !== selection.identity),
    ),
  )
}

/**
 * Decide each selection in request order against the evolving assignment set.
 * A change that would leave nothing assigned is dropped: every removal becomes
 * last_assignment_required and nothing changes.
 */
export function resolveAssignmentOutcomes(
  input: Readonly<{
    selections: readonly ClassifiedSelection[]
    /** Whether each selection's subject belongs to the Property, by index. */
    ownership: readonly boolean[]
    currentByIdentity: ReadonlyMap<string, GoalSubject>
    /** Identities another Goal Program already covers for the same metric. */
    overlapping: ReadonlySet<string>
  }>,
): AssignmentOutcomes {
  const resolved = input.selections.reduce<AssignmentOutcomes>(
    (state, selection, index) =>
      resolveSelection(state, selection, input.ownership[index], input.overlapping),
    { outcomes: [], nextByIdentity: input.currentByIdentity, changed: false },
  )
  if (resolved.nextByIdentity.size > 0) return resolved
  return {
    ...resolved,
    outcomes: resolved.outcomes.map((outcome) =>
      outcome.outcome === 'removed'
        ? { ...outcome, outcome: 'last_assignment_required' }
        : outcome,
    ),
    changed: false,
  }
}
