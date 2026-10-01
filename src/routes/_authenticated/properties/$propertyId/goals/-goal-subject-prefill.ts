// The subject a "New goal" link asks to start from (`?subject=portal_group:<id>`).
// The link comes from a group's page, but anyone can type a URL, so the value is
// used only when it names one of this property's own groups, portals or the
// property itself.
import type { GoalSubject } from '#/contexts/reporting/application/public-api'

export type KnownGoalSubjects = Readonly<{
  propertyId: string
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
  if (kind === 'property' && id === known.propertyId) {
    return [{ kind, propertyId: id }]
  }
  if (kind === 'portal_group' && known.groupIds.includes(id)) {
    return [{ kind, portalGroupId: id }]
  }
  if (kind === 'portal' && known.portalIds.includes(id)) {
    return [{ kind, portalId: id }]
  }
  return []
}
