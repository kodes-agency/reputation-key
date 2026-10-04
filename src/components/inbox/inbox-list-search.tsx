import { X } from 'lucide-react'
import { IconButton } from '#/components/ui/icon-button'
import { ResultCount } from '#/components/ui/result-count'
import { SearchField } from '#/components/ui/search-field'

/**
 * The Inbox's search, in the list header's place while it is open. The field is
 * the shared `SearchField` in its bare form (the header is the frame), so its
 * glyph, input type and length limit are the Properties list's; the bar keeps
 * its own way to close, which the field leaves out. The count reads "N of M"
 * like every list's: M is the queue's own total, which the page knows.
 */
export function InboxListSearch({
  value,
  totalCount,
  queueTotal,
  onChange,
  onClose,
}: Readonly<{
  value: string | undefined
  totalCount: number
  /** What the queue holds before the search; null until its count has arrived. */
  queueTotal: number | null
  onChange: (value: string | undefined) => void
  onClose: () => void
}>) {
  const close = () => {
    onChange(undefined)
    onClose()
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <SearchField
        variant="bare"
        autoFocus
        label="Search reviews"
        value={value ?? ''}
        onValueChange={(next) => onChange(next || undefined)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close()
        }}
      />
      <ResultCount
        className="shrink-0 text-xs"
        shown={totalCount}
        total={queueTotal}
        active={!!value}
      />
      {/* 36px on phones, pulled out 10px so the 16px X glyph sits on the right gutter. */}
      <IconButton
        variant="ghost"
        size="icon-sm"
        className="max-md:-mr-2.5"
        onClick={close}
        label="Close search"
      >
        <X />
      </IconButton>
    </div>
  )
}
