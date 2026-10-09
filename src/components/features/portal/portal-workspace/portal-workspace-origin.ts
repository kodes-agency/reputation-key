// Where the workspace header's way back leads: the list the manager opened the
// portal from, named for what it is, or the property's Portals list when the
// portal was opened from anywhere else (a notification, a bookmark, a reload).
//
// Three lists open a portal: the property's Portals list, a portal group's page
// and All properties (`/portals`, every portal of the organisation). Each keeps
// its filters in the address, so the way back carries the address's search too
// and the manager lands on the list as they left it.

/** The part of a router location this module reads. */
export type WorkspaceOriginLocation = Readonly<{
  pathname: string
  search?: Readonly<Record<string, unknown>>
}>

export type WorkspaceBackTarget = Readonly<{
  /** An absolute path in the app. */
  to: string
  /** The list's own search (filters, sort, page), when the manager came from it. */
  search?: Readonly<Record<string, unknown>>
  label: string
}>

function propertyPortalsPath(propertyId: string): string {
  return `/properties/${propertyId}/portals`
}

/** The property's Portals list: the fallback, and a list a manager opens portals from. */
function propertyList(
  propertyId: string,
  search?: Readonly<Record<string, unknown>>,
): WorkspaceBackTarget {
  return {
    to: propertyPortalsPath(propertyId),
    ...(search ? { search } : {}),
    label: 'Back to portals',
  }
}

/**
 * The way back for a portal of `propertyId`, given the location the manager was
 * on before the workspace opened (`undefined` on a first load). A group is named
 * by `groupName` when its id is one of this property's groups; a group page of
 * another property is not a way back to this portal, so it falls back.
 */
export function workspaceBackTarget(
  from: WorkspaceOriginLocation | undefined,
  propertyId: string,
  groupName: (groupId: string) => string | null,
): WorkspaceBackTarget {
  if (from === undefined) return propertyList(propertyId)
  const { search } = from
  const path = from.pathname.replace(/\/+$/u, '')
  if (path === '/portals') {
    return { to: '/portals', ...(search ? { search } : {}), label: 'Back to all portals' }
  }
  const list = propertyPortalsPath(propertyId)
  if (path === list) return propertyList(propertyId, search)
  const groupId = groupIdIn(path, `${list}/groups/`)
  const name = groupId === null ? null : groupName(groupId)
  if (groupId !== null && name !== null) {
    return {
      to: `${list}/groups/${groupId}`,
      ...(search ? { search } : {}),
      label: `Back to ${name}`,
    }
  }
  return propertyList(propertyId)
}

/** The group id of a group page's path under `prefix`, or null for any other path. */
function groupIdIn(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) return null
  const rest = path.slice(prefix.length)
  return rest === '' || rest.includes('/') ? null : rest
}
