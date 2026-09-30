// What a Portal's "more actions" menu offers. The row already has Edit and
// Share as buttons; the menu holds the rest: where to read results and history,
// finishing a publish, and the recoverable archive. Pure, so each rule that
// keeps an action off a role or a state is tested apart from the menu.
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { canReviewAndPublish } from '../portal-detail/portal-detail-rules'

export type PortalRowAccess = Readonly<{
  canUpdate: boolean
  /** `portal.delete`: archiving is the Portal's only removal, and it is recoverable. */
  canArchive: boolean
  /** The organisation's `portal.write` capability (a separate switch from reading). */
  portalWriteEnabled: boolean
}>

export type PortalRowMenuItemId = 'results' | 'history' | 'review' | 'archive' | 'restore'

export type PortalRowMenuItem = Readonly<{
  id: PortalRowMenuItemId
  label: string
  destructive: boolean
}>

const item = (id: PortalRowMenuItemId, label: string, destructive = false) => ({
  id,
  label,
  destructive,
})

export function portalRowMenu(
  row: Pick<PortalOverviewRow, 'publicationState' | 'pendingChangeCount'>,
  access: PortalRowAccess,
): readonly PortalRowMenuItem[] {
  const { publicationState: state } = row
  const waiting = state === 'draft' || row.pendingChangeCount > 0
  return [
    // A draft has never been seen by a guest, so it has no results to open.
    ...(state === 'draft' ? [] : [item('results', 'Results')]),
    item('history', 'History'),
    ...(waiting && canReviewAndPublish(access, state)
      ? [item('review', 'Review & publish')]
      : []),
    // Archiving and restoring are Portal updates, which the server also
    // refuses while the organisation's `portal.write` capability is off.
    ...(state !== 'archived' && access.canArchive && access.portalWriteEnabled
      ? [item('archive', 'Archive…', true)]
      : []),
    ...(state === 'archived' && access.canUpdate && access.portalWriteEnabled
      ? [item('restore', 'Restore…')]
      : []),
  ]
}
