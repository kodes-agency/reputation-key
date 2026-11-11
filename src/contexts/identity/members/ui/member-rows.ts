// Shapes the member list and the Organization's Property grants into the rows
// the Members table prints. Pure.

import type { MemberRow, PropertyRef } from './member-table'

type Grants = ReadonlyArray<
  Readonly<{ userId: string; propertyIds: ReadonlyArray<string> }>
>

/** userId → that member's active grants. Empty when access is not visible. */
export function propertyIdsByUser(
  access: Grants | undefined,
): ReadonlyMap<string, ReadonlyArray<string>> {
  return new Map((access ?? []).map((grant) => [grant.userId, grant.propertyIds]))
}

/**
 * Each member with the listed properties they can work. `access` is undefined
 * for a viewer who may not see it, and then no row carries `properties`. A grant
 * on a property that is no longer listed (archived) has nothing to name and is
 * dropped.
 */
export function memberRowsWithProperties(
  members: ReadonlyArray<Omit<MemberRow, 'properties'>>,
  access: Grants | undefined,
  properties: ReadonlyArray<PropertyRef>,
): MemberRow[] {
  if (access === undefined) return members.map((member) => ({ ...member }))
  const byUser = propertyIdsByUser(access)
  return members.map((member) => {
    const granted = new Set(byUser.get(member.userId) ?? [])
    return { ...member, properties: properties.filter((p) => granted.has(p.id)) }
  })
}
