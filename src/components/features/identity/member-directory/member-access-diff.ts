// Pure helpers for the Manage access sheet: what a save would change, and the
// small immutable selection edits the checklist makes. No React, no I/O.

type Ids = ReadonlyArray<string>

export type PropertyAccessDiff = Readonly<{
  grantPropertyIds: Ids
  revokePropertyIds: Ids
}>

const unique = (ids: Ids): string[] => [...new Set(ids)]

/** Properties to grant and revoke so `initial` becomes `selected`. */
export function diffPropertyAccess(initial: Ids, selected: Ids): PropertyAccessDiff {
  const had = new Set(initial)
  const wants = new Set(selected)
  return {
    grantPropertyIds: unique(selected).filter((id) => !had.has(id)),
    revokePropertyIds: unique(initial).filter((id) => !wants.has(id)),
  }
}

export type MemberAccessState = Readonly<{
  propertyIds: Ids
  /** Properties whose Responsible managers include the member. */
  responsibleIds: Ids
}>

export type MemberAccessChange = PropertyAccessDiff &
  Readonly<{
    responsibleOnPropertyIds: Ids
    responsibleOffPropertyIds: Ids
    isEmpty: boolean
  }>

/**
 * What saving the sheet would change. Responsibility counts only on a Property
 * the member will still have: a revoked Property releases its responsibility on
 * the server, so the sheet never sends that as a separate change.
 */
export function diffMemberAccess(
  initial: MemberAccessState,
  selected: MemberAccessState,
): MemberAccessChange {
  const access = diffPropertyAccess(initial.propertyIds, selected.propertyIds)
  const kept = new Set(selected.propertyIds)
  const wasResponsible = new Set(initial.responsibleIds)
  const wantsResponsible = new Set(selected.responsibleIds)
  const responsibleOnPropertyIds = unique(selected.responsibleIds).filter(
    (id) => kept.has(id) && !wasResponsible.has(id),
  )
  const responsibleOffPropertyIds = unique(initial.responsibleIds).filter(
    (id) => kept.has(id) && !wantsResponsible.has(id),
  )
  return {
    ...access,
    responsibleOnPropertyIds,
    responsibleOffPropertyIds,
    isEmpty:
      access.grantPropertyIds.length === 0 &&
      access.revokePropertyIds.length === 0 &&
      responsibleOnPropertyIds.length === 0 &&
      responsibleOffPropertyIds.length === 0,
  }
}

/** `ids` with `id` added when absent, removed when present. */
export function toggleId(ids: Ids, id: string): string[] {
  return ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id]
}

/**
 * Select or clear every Property currently listed. A search narrows the list,
 * and a selection made before it (now filtered out) is left as it was.
 */
export function selectAllVisible(
  selected: Ids,
  visible: Ids,
  shouldSelect: boolean,
): string[] {
  if (shouldSelect) return unique([...selected, ...visible])
  const hidden = new Set(visible)
  return selected.filter((id) => !hidden.has(id))
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: Ids): string {
  const last = names.at(-1) ?? ''
  if (names.length <= 1) return last
  return `${names.slice(0, -1).join(', ')} and ${last}`
}

/**
 * The plain-language lines shown above Save: what this change does, before it
 * is made. Empty for no change. `who` is how the sheet addresses the member.
 */
export function summarizeAccessChange(
  change: MemberAccessChange,
  nameOf: (propertyId: string) => string,
  who: string,
): string[] {
  const names = (ids: Ids) => joinNames(ids.map(nameOf))
  const lines: string[] = []
  if (change.grantPropertyIds.length > 0) {
    lines.push(`Gives ${who} access to ${names(change.grantPropertyIds)}.`)
  }
  if (change.revokePropertyIds.length > 0) {
    const its = change.revokePropertyIds.length === 1 ? 'its' : 'their'
    lines.push(
      `Removes access to ${names(change.revokePropertyIds)}. ${who} loses ${its} Inbox, and any Responsible manager role there is released.`,
    )
  }
  if (change.responsibleOnPropertyIds.length > 0) {
    const its = change.responsibleOnPropertyIds.length === 1 ? 'its' : 'their'
    lines.push(
      `Makes ${who} responsible for ${names(change.responsibleOnPropertyIds)}: ${who} gets ${its} review, feedback and health updates.`,
    )
  }
  if (change.responsibleOffPropertyIds.length > 0) {
    lines.push(
      `${who} stops being responsible for ${names(change.responsibleOffPropertyIds)}.`,
    )
  }
  if (change.grantPropertyIds.length > 0 || change.revokePropertyIds.length > 0) {
    lines.push(`We tell ${who} in the app and by email.`)
  }
  return lines
}
