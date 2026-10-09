// The one answer to "may this person change this portal here?", for every
// surface of the workspace that edits. The server refuses a portal write without
// the role's `portal.update` permission or the organisation's `portal.write`
// capability (a controlled-beta switch, separate from reading), and an archived
// portal is read-only for everyone. A surface that checked only the role looked
// usable while the capability was off, and every write failed with a "Not
// saved" that a retry could not fix.
//
// When the answer is no, `readOnlyReason` says why, so the workspace can say it
// once, in plain words, under its header.

import type { PortalPublicationState } from '../shared/types'

export type PortalReadOnlyReason = 'archived' | 'role' | 'capability'

export type PortalEditAccess = Readonly<{
  canEdit: boolean
  /** Why nothing here can be changed; null while it can. */
  readOnlyReason: PortalReadOnlyReason | null
}>

export function portalEditAccess(
  input: Readonly<{
    /** The role's `portal.update` permission. */
    canUpdate: boolean
    /** The organisation's `portal.write` capability. */
    portalWriteEnabled: boolean
    publicationState: PortalPublicationState
  }>,
): PortalEditAccess {
  // Archived first: it is true for everyone, and the way out (Restore) is the
  // portal's, not the person's.
  const reason: PortalReadOnlyReason | null =
    input.publicationState === 'archived'
      ? 'archived'
      : !input.canUpdate
        ? 'role'
        : !input.portalWriteEnabled
          ? 'capability'
          : null
  return { canEdit: reason === null, readOnlyReason: reason }
}

/** Whether an archived portal may be restored here: the same pair a portal write needs. */
export function canRestorePortal(
  input: Readonly<{ canUpdate: boolean; portalWriteEnabled: boolean }>,
): boolean {
  return input.canUpdate && input.portalWriteEnabled
}
