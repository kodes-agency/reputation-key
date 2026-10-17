// A goal's subjects by name: one subject's own name, and who a goal is for as a
// short list ("Reception and 2 more") on the Goals list and a goal's page. It
// sits here, beside the one name, so the two routes that name a goal's subjects
// share a module they already load rather than a new chunk (first paint's
// preload map grows with every chunk two routes share).
import type { GoalSubject } from '#/contexts/reporting/application/public-api'

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

// Pinned, not the runtime's: the server and the browser must order the same
// names alike ("Spa" before "Рецепция" in every language), and "Bar 2" comes
// before "Bar 10".
const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

const SUBJECT_ORDER: Readonly<Record<GoalSubject['kind'], number>> = {
  property: 0,
  portal_group: 1,
  portal: 2,
}

/**
 * Who a goal is for, by name: "Reception", the property's name or "Rooms
 * (group)" for one; "Reception and Spa" for two; "Reception and 2 more" for
 * three or more. The property comes first, then groups, then portals, each in
 * name order. Null for a goal with no subject. `nameOf` gives a subject's own
 * name.
 */
export function goalListSubjectText(
  subjects: readonly GoalSubject[],
  nameOf: (subject: GoalSubject) => string,
): string | null {
  const names = subjects
    .map((subject) => ({
      kind: subject.kind,
      name:
        subject.kind === 'portal_group' ? `${nameOf(subject)} (group)` : nameOf(subject),
    }))
    .sort(
      (left, right) =>
        SUBJECT_ORDER[left.kind] - SUBJECT_ORDER[right.kind] ||
        byName.compare(left.name, right.name),
    )
    .map(({ name }) => name)
  const [first, second] = names
  if (first === undefined) return null
  if (second === undefined) return first
  return names.length === 2
    ? `${first} and ${second}`
    : `${first} and ${names.length - 1} more`
}
