import { Flag, MessageSquareText, Star, UserRoundCheck } from 'lucide-react'
import { Checkbox } from '#/components/ui/checkbox'
import { cn } from '#/lib/utils'
import { INBOX_BULK_LIMIT, type InboxItem } from '#/contexts/inbox/application/public-api'
import type { InboxCurrentUser } from './inbox-case-toolbar-props'
import type { InboxAssignmentOption } from './inbox-owner-view'
import { inboxRowView } from './inbox-list-row-view'
import { STAR_FILLED_CLASS } from './inbox-detail-helpers'
import { formatDateTime } from './utils'

export function InboxListRow({
  item,
  isChecked,
  isActive,
  selectionAtLimit,
  selectionMode,
  allProperties,
  assignmentOptions,
  currentUser,
  viewedUpTo,
  onToggleSelect,
  onOpen,
}: Readonly<{
  item: InboxItem
  isChecked: boolean
  isActive: boolean
  selectionAtLimit: boolean
  selectionMode: boolean
  allProperties: boolean
  assignmentOptions: ReadonlyArray<InboxAssignmentOption>
  currentUser?: InboxCurrentUser
  viewedUpTo: Date | null
  onToggleSelect: (id: string) => void
  onOpen: (item: InboxItem) => void
}>) {
  const view = inboxRowView(item, { assignmentOptions, currentUser, viewedUpTo })
  const selectionDisabled = selectionAtLimit && !isChecked
  const ownerDescriptionId = `inbox-owner-${item.id}`
  return (
    <div
      role="listitem"
      data-inbox-list-row
      className={cn(
        'group flex h-[78px] overflow-hidden border-b px-3 py-3 transition-colors hover:bg-accent/40',
        (isActive || isChecked) && 'bg-accent',
      )}
    >
      <div className="relative mr-2 flex w-5 shrink-0 items-start justify-center pt-0.5">
        {view.isNew && !isChecked && !selectionMode && (
          <span className="mt-1.5 size-2 rounded-full bg-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
            <span className="sr-only">New since your last visit</span>
          </span>
        )}
        <Checkbox
          checked={isChecked}
          disabled={selectionDisabled}
          className={cn(
            'absolute opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
            (isChecked || selectionMode) && 'opacity-100',
          )}
          onCheckedChange={() => onToggleSelect(item.id)}
          aria-label={
            selectionDisabled
              ? `Select item from ${view.name} (${INBOX_BULK_LIMIT} item limit reached)`
              : `Select item from ${view.name}`
          }
        />
      </div>
      <button
        type="button"
        aria-current={isActive ? 'true' : undefined}
        aria-label={view.accessibleName}
        aria-describedby={view.owner.isAssigned ? ownerDescriptionId : undefined}
        className="flex min-w-0 flex-1 gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onOpen(item)}
      >
        <span className="min-w-0 flex-1">
          <span className="flex h-[18px] min-w-0 items-center gap-1 text-[13px] leading-[18px]">
            {item.rating !== null ? (
              <>
                <Star className={`size-3.5 ${STAR_FILLED_CLASS}`} aria-hidden="true" />
                <span className="tabular-nums">{item.rating}</span>
              </>
            ) : item.sourceType === 'feedback' ? (
              <MessageSquareText className="size-3.5" aria-hidden="true" />
            ) : null}
            <span className="truncate font-medium">{view.name}</span>
            {allProperties && item.propertyName && (
              <span className="truncate text-muted-foreground">
                · {item.propertyName}
              </span>
            )}
          </span>
          <span className="mt-1 line-clamp-2 h-9 text-[13px] leading-[18px] text-muted-foreground">
            {view.signals.map((signal) => (
              <span
                key={signal}
                className={cn(
                  'mr-1.5 font-medium text-foreground',
                  signal === 'Escalated' && 'text-negative',
                )}
              >
                {signal === 'Escalated' && (
                  <Flag className="mr-0.5 inline size-3" aria-hidden="true" />
                )}
                {signal} ·
              </span>
            ))}
            <span
              className={cn(
                item.contentAvailability !== 'text' &&
                  !item.snippet &&
                  'text-muted-foreground/70',
              )}
            >
              {view.content}
            </span>
          </span>
        </span>
        <span className="flex w-11 shrink-0 flex-col items-end justify-between text-xs">
          <time
            className="tabular-nums text-muted-foreground"
            dateTime={new Date(item.sourceDate).toISOString()}
            title={formatDateTime(item.sourceDate)}
          >
            {view.age}
          </time>
          {view.owner.initials ? (
            <span
              title={view.owner.label}
              className="flex size-5 items-center justify-center rounded-full bg-border text-[10px] font-semibold"
            >
              {view.owner.initials}
            </span>
          ) : view.owner.isAssigned ? (
            <UserRoundCheck
              className="size-4 text-muted-foreground"
              aria-label="Assigned"
            />
          ) : (
            <span className="size-5" />
          )}
        </span>
      </button>
      {view.owner.isAssigned && (
        <span id={ownerDescriptionId} className="sr-only">
          Assigned to {view.owner.label}
        </span>
      )}
    </div>
  )
}
