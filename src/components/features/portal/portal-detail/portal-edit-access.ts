// The one answer to "may this person change this portal here?", for every
// surface of the workspace that edits. It starts from the Portals pages' rule
// (`portalAccessOf`: the role's `portal.update` and the organisation's
// `portal.write` capability, both of which the server enforces on every portal
// write) and adds the portal's own state: an archived portal is kept exactly as
// it was, for everyone. A surface that checked only the role looked usable while
// the capability was off, and every write failed with a "Not saved" that a retry
// could not fix.
//
// When the answer is no, `readOnlyReason` says why, so the workspace can say it
// once, in plain words, under its header. The reasons come in the order the
// person could act on them: a role that does not allow changes cannot restore a
// portal either, and while changes are off nothing can be restored.

import type { PortalAccess } from '../portal-overview/use-portal-access'
import type { PortalPublicationState } from '../shared/types'

export type PortalReadOnlyReason = 'role' | 'capability' | 'archived'

export type PortalEditAccess = Readonly<{
  canEdit: boolean
  /** Why nothing here can be changed; null while it can. */
  readOnlyReason: PortalReadOnlyReason | null
  /** An archived portal this person may bring back (a restore is a portal write). */
  canRestore: boolean
}>

export function portalEditAccess(
  access: Pick<PortalAccess, 'canEdit' | 'changesOff'>,
  publicationState: PortalPublicationState,
): PortalEditAccess {
  const archived = publicationState === 'archived'
  const reason: PortalReadOnlyReason | null = !access.canEdit
    ? access.changesOff
      ? 'capability'
      : 'role'
    : archived
      ? 'archived'
      : null
  return {
    canEdit: reason === null,
    readOnlyReason: reason,
    canRestore: archived && access.canEdit,
  }
}
