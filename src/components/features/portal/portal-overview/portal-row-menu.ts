// What a Portal's "more actions" menu offers. The row already has Edit and
// Share as buttons; the menu holds the rest: where to read results and history,
// finishing a publish (or bringing a disabled page back), taking a live page
// down, and the recoverable archive. Pure, so each rule that keeps an action off
// a role or a state is tested apart from the menu.
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { canReviewAndPublish } from '../portal-detail/portal-detail-rules'

export type PortalRowAccess = Readonly<{
  canUpdate: boolean
  /** `portal.delete`: archiving is the Portal's only removal, and it is recoverable. */
  canArchive: boolean
  /** The organisation's `portal.write` capability (a separate switch from reading). */
  portalWriteEnabled: boolean
}>

export type PortalRowMenuItemId =
  'results' | 'history' | 'review' | 'disable' | 'archive' | 'restore'

// No entry is destructive: disabling a page and archiving a Portal are both undone
// (Review & publish, Restore), so their menu items are neutral like their
// confirmations. Red is for an action that cannot be taken back.
export type PortalRowMenuItem = Readonly<{
  id: PortalRowMenuItemId
  label: string
}>

const item = (id: PortalRowMenuItemId, label: string) => ({ id, label })

export function portalRowMenu(
  row: Pick<PortalOverviewRow, 'publicationState' | 'pendingChangeCount'>,
  access: PortalRowAccess,
): readonly PortalRowMenuItem[] {
  const { publicationState: state } = row
  // A disabled page comes back through Review & publish, like a first publish.
  const waiting = state === 'draft' || state === 'disabled' || row.pendingChangeCount > 0
  const canWrite = access.canUpdate && access.portalWriteEnabled
  return [
    // A draft has never been seen by a guest, so it has no results to open.
    ...(state === 'draft' ? [] : [item('results', 'Results')]),
    item('history', 'History'),
    ...(waiting && canReviewAndPublish(access, state)
      ? [item('review', 'Review & publish')]
      : []),
    // Taking a live page down is a Portal update, refused like one while the
    // organisation's `portal.write` capability is off.
    ...(state === 'published' && canWrite
      ? [item('disable', 'Disable public page…')]
      : []),
    // Archiving and restoring are Portal updates, which the server also
    // refuses while the organisation's `portal.write` capability is off.
    ...(state !== 'archived' && access.canArchive && access.portalWriteEnabled
      ? [item('archive', 'Archive…')]
      : []),
    ...(state === 'archived' && canWrite ? [item('restore', 'Restore…')] : []),
  ]
}
