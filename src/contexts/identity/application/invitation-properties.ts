// Identity context — the invited Properties' display names.
//
// Invitations store Property ids only. Names come from the Property public API
// through composition (PropertyNameLookup), in one batched call per request;
// a deleted or foreign Property is simply absent and is dropped.

import type { OrganizationId } from '#/shared/domain/ids'
import type { PropertyNameLookup } from './ports/invitation-read-model.port'

export type InvitationProperty = Readonly<{ id: string; name: string }>

/** Names of the given Properties, keyed by id; absent or unnamed ones are left out. */
export async function lookupPropertyNames(
  lookup: PropertyNameLookup,
  orgId: OrganizationId,
  ids: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const found = await lookup(orgId, unique)
  return new Map(
    found.flatMap((property) =>
      property.name === null ? [] : [[property.id, property.name] as const],
    ),
  )
}

/** The invitation's Properties that still resolve, in the invitation's order. */
export function pickInvitationProperties(
  names: ReadonlyMap<string, string>,
  ids: ReadonlyArray<string>,
): ReadonlyArray<InvitationProperty> {
  return [...new Set(ids)].flatMap((id) => {
    const name = names.get(id)
    return name === undefined ? [] : [{ id, name }]
  })
}

/** One invitation's resolvable Properties. */
export async function resolveInvitationProperties(
  lookup: PropertyNameLookup,
  orgId: OrganizationId,
  ids: ReadonlyArray<string>,
): Promise<ReadonlyArray<InvitationProperty>> {
  return pickInvitationProperties(await lookupPropertyNames(lookup, orgId, ids), ids)
}
