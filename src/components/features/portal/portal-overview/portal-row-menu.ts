// What a Portal's row offers: Edit (or View) and Share as buttons, and behind
// "more actions" the rest: where to read results and history, finishing a publish
// (or bringing a disabled page back), taking a live page down, and the
// recoverable archive. Pure, so each rule that keeps an action off a role or a
// state is tested apart from the menu.
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

/**
 * The row's two buttons. Edit says View where the Portal cannot be changed: the
 * person may not change portals, or the Portal is archived and kept as it was,
 * so the button lands on a page that is read-only. Share is offered for every
 * Portal but an archived one, which is finished: a draft has a code to give out
 * (publishing needs one) and Share is where it is made.
 */
export function portalRowButtons(
  row: Pick<PortalOverviewRow, 'publicationState'>,
  canEdit: boolean,
): Readonly<{ verb: 'Edit' | 'View'; canShare: boolean }> {
  const archived = row.publicationState === 'archived'
  return { verb: canEdit && !archived ? 'Edit' : 'View', canShare: !archived }
}

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
      ? [item('disable', 'Disable public page')]
      : []),
    // Archiving and restoring are Portal updates, which the server also
    // refuses while the organisation's `portal.write` capability is off.
    ...(state !== 'archived' && access.canArchive && access.portalWriteEnabled
      ? [item('archive', 'Archive')]
      : []),
    ...(state === 'archived' && canWrite ? [item('restore', 'Restore')] : []),
  ]
}
