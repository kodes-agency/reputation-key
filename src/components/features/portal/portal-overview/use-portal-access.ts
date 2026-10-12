// May this person change portals here? One answer for the Portals pages: the
// role's permission AND the organisation's `portal.write` capability, which the
// server enforces on every portal write whatever the role says. A surface that
// checked only the role offered Edit, New portal and the rest, and let the write
// fail with a "Not saved" the person could not put right.
//
// `changesOff` is the case worth a line of words: the role may change portals, and
// the capability is the only thing in the way.
import type { Permission } from '#/shared/domain/permissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'

export type PortalAccess = Readonly<{
  /** May edit a portal (Edit rather than View) and publish its changes. */
  canEdit: boolean
  /** May make a portal or a group. */
  canCreate: boolean
  /** May archive and restore. */
  canArchive: boolean
  /** The role may change portals but the capability is off: say why nothing can be changed. */
  changesOff: boolean
}>

export function portalAccessOf(
  can: (permission: Permission) => boolean,
  writeEnabled: boolean,
): PortalAccess {
  const roleMayWrite = can('portal.update') || can('portal.create')
  return {
    canEdit: can('portal.update') && writeEnabled,
    canCreate: can('portal.create') && writeEnabled,
    canArchive: can('portal.delete') && writeEnabled,
    changesOff: roleMayWrite && !writeEnabled,
  }
}

export function usePortalAccess(): PortalAccess {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  return portalAccessOf(can, has('portal.write'))
}
