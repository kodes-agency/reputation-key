import type { GoalSubject } from '#/contexts/goal/application/public-api'

export function goalAssignmentSubjectLabel(
  subject: GoalSubject,
  propertyName: string,
  groups: readonly Readonly<{ id: string; name: string }>[],
  portals: readonly Readonly<{ id: string; name: string }>[],
): string {
  if (subject.kind === 'property') return propertyName
  if (subject.kind === 'portal_group') {
    return groups.find((group) => group.id === subject.portalGroupId)?.name ?? 'Group'
  }
  return portals.find((portal) => portal.id === subject.portalId)?.name ?? 'Portal'
}
