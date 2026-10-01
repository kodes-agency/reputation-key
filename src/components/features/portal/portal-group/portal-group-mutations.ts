// The writes a group's dialogs and page make, as the actions the route supplies.
// Each takes the server function's own input, so the components never build a
// request the server does not understand.
import type { Action } from '#/components/hooks/use-action'

export type PortalGroupMutations = Readonly<{
  /** A new group with the Portals ticked; one already in another group moves. */
  createMutation: Action<{
    data: { propertyId: string; name: string; portalIds?: string[] }
  }>
  renameMutation: Action<{ data: { portalGroupId: string; name: string } }>
  /** The group is archived: its Portals stay, and its history with it. */
  archiveGroupMutation: Action<{ data: { portalGroupId: string } }>
  /** Brings a Portal in, out of whichever group it is in. */
  movePortalMutation: Action<{ data: { portalGroupId: string; portalId: string } }>
  removePortalMutation: Action<{ data: { portalGroupId: string; portalId: string } }>
}>

export type PortalGroupRef = Readonly<{ id: string; name: string }>
