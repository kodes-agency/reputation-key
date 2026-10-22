// Why the Page tab is read-only, in one line, for someone who can look but not
// change: the role does not allow it, portal changes are switched off for the
// organisation, or the portal is archived and kept as it was. Without it the
// fields are disabled and nothing says why (the Portals list has the same
// kind of line). Pure, so each sentence is tested once.

type Input = Readonly<{
  /** The role may update portals and the organisation's `portal.write` capability is on. */
  canEdit: boolean
  /** The role may change portals and the capability is the only thing in the way. */
  changesOff: boolean
  archived: boolean
}>

const LOOK = 'You can look at this portal, but'

/**
 * Null when the portal can be edited. The reasons are given in the order the
 * person could act on them: a role that does not allow changes cannot restore a
 * portal either, and while changes are off nothing can be restored.
 */
export function describeEditorReadOnly({
  canEdit,
  changesOff,
  archived,
}: Input): string | null {
  if (!canEdit) {
    return changesOff
      ? `${LOOK} changing portals isn’t available for your organization right now.`
      : `${LOOK} your role doesn’t allow changing it.`
  }
  return archived
    ? `${LOOK} not change it while it is archived. Restore it from the Portals list to edit it.`
    : null
}
