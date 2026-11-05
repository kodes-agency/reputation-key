// URLs are untrusted. Accept only this Property's offered Portals or groups; the
// Property-wide goal is set separately from its card.

import type { GoalSubject } from '#/contexts/reporting/application/public-api'

export type KnownGoalSubjects = Readonly<{
  groupIds: readonly string[]
  portalIds: readonly string[]
}>

export function prefilledGoalSubjects(
  raw: string | undefined,
  known: KnownGoalSubjects,
): readonly GoalSubject[] {
  if (raw === undefined) return []
  const separator = raw.indexOf(':')
  const kind = raw.slice(0, separator)
  const id = raw.slice(separator + 1)
  if (separator < 0 || id === '') return []
  if (kind === 'portal_group' && known.groupIds.includes(id)) {
    return [{ kind, portalGroupId: id }]
  }
  if (kind === 'portal' && known.portalIds.includes(id)) {
    return [{ kind, portalId: id }]
  }
  return []
}
