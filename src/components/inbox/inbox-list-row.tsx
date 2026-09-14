import { Flag, MessageSquareText, Star, UserRoundCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { Checkbox } from '#/components/ui/checkbox'
import { cn } from '#/lib/utils'
import { INBOX_BULK_LIMIT, type InboxItem } from '#/contexts/inbox/application/public-api'
import type { InboxCurrentUser } from './inbox-case-toolbar-props'
import type { InboxAssignmentOption } from './inbox-owner-view'
import { inboxRowView } from './inbox-list-row-view'
import { STAR_FILLED_CLASS } from './inbox-detail-helpers'
import { formatDateTime } from './utils'

type RowView = ReturnType<typeof inboxRowView>

type InboxListRowProps = Readonly<{
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
}>

function RowSelectionGutter({
  item,
  view,
  isChecked,
  selectionAtLimit,
  selectionMode,
  onToggleSelect,
}: Pick<
  InboxListRowProps,
  'item' | 'isChecked' | 'selectionAtLimit' | 'selectionMode' | 'onToggleSelect'
> &
  Readonly<{ view: RowView }>) {
  const selectionDisabled = selectionAtLimit && !isChecked
  const label = selectionDisabled
    ? `Select item from ${view.name} (${INBOX_BULK_LIMIT} item limit reached)`
    : `Select item from ${view.name}`

  return (
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
        aria-label={label}
      />
    </div>
  )
}

function RowIdentity({
  item,
  view,
  allProperties,
}: Pick<InboxListRowProps, 'item' | 'allProperties'> & Readonly<{ view: RowView }>) {
  return (
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
        <span className="truncate text-muted-foreground">· {item.propertyName}</span>
      )}
    </span>
  )
}

function RowSummary({ item, view }: Readonly<{ item: InboxItem; view: RowView }>) {
  return (
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
  )
}

function RowTrailing({ item, view }: Readonly<{ item: InboxItem; view: RowView }>) {
  let owner: ReactNode = <span className="size-5" />
  if (view.owner.initials) {
    owner = (
      <span
        title={view.owner.label}
        className="flex size-5 items-center justify-center rounded-full bg-border text-[10px] font-semibold"
      >
        {view.owner.initials}
      </span>
    )
  } else if (view.owner.isAssigned) {
    owner = (
      <UserRoundCheck className="size-4 text-muted-foreground" aria-label="Assigned" />
    )
  }

  return (
    <span className="flex w-11 shrink-0 flex-col items-end justify-between text-xs">
      <time
        className="tabular-nums text-muted-foreground"
        dateTime={new Date(item.sourceDate).toISOString()}
        title={formatDateTime(item.sourceDate)}
      >
        {view.age}
      </time>
      {owner}
    </span>
  )
}

function RowOpenButton({
  item,
  view,
  isActive,
  allProperties,
  ownerDescriptionId,
  onOpen,
}: Pick<InboxListRowProps, 'item' | 'isActive' | 'allProperties' | 'onOpen'> &
  Readonly<{ view: RowView; ownerDescriptionId: string }>) {
  return (
    <button
      type="button"
      aria-current={isActive ? 'true' : undefined}
      aria-label={view.accessibleName}
      aria-describedby={view.owner.isAssigned ? ownerDescriptionId : undefined}
      className="flex min-w-0 flex-1 gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onOpen(item)}
    >
      <span className="min-w-0 flex-1">
        <RowIdentity item={item} view={view} allProperties={allProperties} />
        <RowSummary item={item} view={view} />
      </span>
      <RowTrailing item={item} view={view} />
    </button>
  )
}

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
}: InboxListRowProps) {
  const view = inboxRowView(item, { assignmentOptions, currentUser, viewedUpTo })
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
      <RowSelectionGutter
        item={item}
        view={view}
        isChecked={isChecked}
        selectionAtLimit={selectionAtLimit}
        selectionMode={selectionMode}
        onToggleSelect={onToggleSelect}
      />
      <RowOpenButton
        item={item}
        view={view}
        isActive={isActive}
        allProperties={allProperties}
        ownerDescriptionId={ownerDescriptionId}
        onOpen={onOpen}
      />
      {view.owner.isAssigned && (
        <span id={ownerDescriptionId} className="sr-only">
          Assigned to {view.owner.label}
        </span>
      )}
    </div>
  )
}
