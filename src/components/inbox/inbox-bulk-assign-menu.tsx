import { ChevronDown, UserRoundCog } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { InboxAssignmentOption } from './inbox-owner-view'

export function InboxBulkAssignMenu({
  itemCount,
  options,
  pending,
  onAssign,
}: Readonly<{
  itemCount: number
  options: ReadonlyArray<InboxAssignmentOption>
  pending: boolean
  onAssign: (userId: string | null) => void
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-md:size-9 max-md:px-0"
          disabled={pending || itemCount === 0}
          aria-label={`Assign ${itemCount} items`}
        >
          <UserRoundCog />
          <span className="max-md:sr-only">Assign</span>
          <ChevronDown className="max-md:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.userId}
            className="max-md:min-h-11"
            onSelect={() => onAssign(option.userId)}
          >
            {option.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="max-md:min-h-11" onSelect={() => onAssign(null)}>
          Unassign
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          Applies to all {itemCount} or none
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
