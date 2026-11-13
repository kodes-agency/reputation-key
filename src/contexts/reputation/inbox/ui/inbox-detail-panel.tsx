import { RegionError } from '#/components/ui/region-error'
import { InboxDetailContent } from '#/contexts/reputation/inbox/ui/inbox-detail-content'
import { InboxDetailPending } from '#/contexts/reputation/inbox/ui/inbox-detail-pending'
import { InboxDetailHeader } from '#/contexts/reputation/inbox/ui/inbox-detail-header'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { useInboxDetail } from '#/contexts/reputation/inbox/ui/use-inbox-detail'
import { isCaseToolbarShown } from './inbox-case-toolbar-props'

type DetailState = ReturnType<typeof useInboxDetail>

interface InboxDetailPanelProps {
  selectedItem: InboxItem
  detailState: DetailState
  onClose: () => void
}

/**
 * The desktop pane: one bounded flex column, four regions, and only the third
 * one scrolls. `overflow-hidden` here and `CLIP_PANEL_CONTENT` on the Panel are
 * what stop the whole pane from scrolling; the header and the case toolbar carry
 * `shrink-0`, and so does the composer at the foot, so the thread's scroller is
 * the only region that gives up space.
 */
export function InboxDetailPanel({
  selectedItem,
  detailState,
  onClose,
}: InboxDetailPanelProps) {
  const currentItem = detailState.currentItem ?? selectedItem
  return (
    <div className="hidden md:flex h-full min-w-0 flex-col border-l overflow-hidden">
      {currentItem && (
        <InboxDetailHeader
          item={currentItem}
          detail={detailState.detail}
          googleCheck={detailState.googleCheck}
          onClose={onClose}
        />
      )}

      {/* The same predicate the `e` shortcut asks (`inbox-case-toolbar-props.ts`),
          so the key can never reach an Escalate this branch has not rendered.
          `!currentItem` only narrows the type for the content branch. */}
      {!isCaseToolbarShown(detailState) || !currentItem ? (
        detailState.error ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <RegionError
              size="compact"
              message={detailState.error}
              onRetry={() => detailState.refetch()}
              retrying={detailState.retrying}
            />
          </div>
        ) : (
          <InboxDetailPending />
        )
      ) : (
        <InboxDetailContent currentItem={currentItem} detailState={detailState} />
      )}
    </div>
  )
}
