import { Search, X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'

export function InboxListSearch({
  value,
  totalCount,
  onChange,
  onClose,
}: Readonly<{
  value: string | undefined
  totalCount: number
  onChange: (value: string | undefined) => void
  onClose: () => void
}>) {
  const close = () => {
    onChange(undefined)
    onClose()
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <Input
        autoFocus
        aria-label="Search reviews"
        placeholder="Search reviews"
        value={value ?? ''}
        className="h-8 min-w-0 flex-1 border-0 px-0 shadow-none focus-visible:ring-0 max-md:h-9"
        onChange={(event) => onChange(event.target.value || undefined)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close()
        }}
      />
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {totalCount} matches
      </span>
      <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close search">
        <X />
      </Button>
    </div>
  )
}
