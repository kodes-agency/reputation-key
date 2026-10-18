// The subject an "Add a portal goal" address asks to start from
// (`?add=group&subject=portal_group:<id>`, PLAN PG-20). The link comes from a
// group's page (or an old New goal link), but anyone can type a URL, so the
// value is used only when it names one of this property's own groups or
// portals. The whole property is never a subject here: its goal is the Monthly
// portal goal, set from its card (ADR 0068).
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
