// Below the desktop floor there is no queue rail, so the list header's scope line
// becomes the property control. It opens the rail's property list, counted for
// the queue on screen.
import { Building2, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { scopeCount, type InboxPropertyScope } from './inbox-property-scope'

/** Radio value for the organization-wide scope; property ids are UUIDs. */
const ALL_PROPERTIES = 'all'

function ScopeMenuItem({
  value,
  label,
  count,
  withGlyph = false,
}: Readonly<{
  value: string
  label: string
  count: number | undefined
  withGlyph?: boolean
}>) {
  return (
    <DropdownMenuRadioItem value={value} className="min-h-11">
      {withGlyph ? (
        <Building2 className="text-muted-foreground" aria-hidden="true" />
      ) : (
        <span className="size-4 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      )}
    </DropdownMenuRadioItem>
  )
}

export function InboxScopeMenu({
  scope,
  scopeLabel,
  queueLabel,
}: Readonly<{ scope: InboxPropertyScope; scopeLabel: string; queueLabel: string }>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex max-w-full min-w-0 items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 max-md:h-9 max-md:rounded-md max-md:px-2 max-md:text-[13px] max-md:font-medium max-md:text-foreground"
        >
          <span className="truncate">{scopeLabel}</span>
          <ChevronDown
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{queueLabel} by property</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={scope.activePropertyId ?? ALL_PROPERTIES}
          onValueChange={(value) =>
            scope.onSelect(value === ALL_PROPERTIES ? null : value)
          }
        >
          {scope.includeAll && (
            <>
              <ScopeMenuItem
                value={ALL_PROPERTIES}
                label="All properties"
                count={scopeCount(scope.counts, null)}
                withGlyph
              />
              <DropdownMenuSeparator />
            </>
          )}
          {scope.properties.map((property) => (
            <ScopeMenuItem
              key={property.id}
              value={property.id}
              label={property.name}
              count={scopeCount(scope.counts, property.id)}
            />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
