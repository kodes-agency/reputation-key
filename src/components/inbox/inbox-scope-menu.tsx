// Below the desktop floor there is no queue rail, so the list header's scope line
// becomes the property control. It opens the rail's property list, counted for
// the queue on screen.
//
// Single-choice rows are plain menu items with `menuitemradio` semantics rather
// than Radix's RadioGroup/RadioItem: those live in the same Radix module as the
// app sidebar's menu, which is first paint, so using them anywhere adds their
// code to the initial closure (~300 B gzip, scripts/check-bundle-budget.mjs).
import { useId } from 'react'
import { Building2, Check, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { scopeCount, type InboxPropertyScope } from './inbox-property-scope'

function ScopeMenuItem({
  label,
  count,
  checked,
  withGlyph = false,
  onSelect,
}: Readonly<{
  label: string
  count: number | undefined
  checked: boolean
  withGlyph?: boolean
  onSelect: () => void
}>) {
  return (
    <DropdownMenuItem
      role="menuitemradio"
      aria-checked={checked}
      className="min-h-11"
      onSelect={onSelect}
    >
      {withGlyph ? (
        <Building2 aria-hidden="true" />
      ) : (
        <span className="size-4 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      )}
      <span
        className="flex size-4 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        {checked && <Check className="text-foreground" />}
      </span>
    </DropdownMenuItem>
  )
}

export function InboxScopeMenu({
  scope,
  scopeLabel,
  queueLabel,
}: Readonly<{ scope: InboxPropertyScope; scopeLabel: string; queueLabel: string }>) {
  const labelId = useId()
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
      <DropdownMenuContent align="start" className="w-64" aria-labelledby={labelId}>
        <div id={labelId} className="px-2 py-1.5 text-sm font-medium">
          {queueLabel} by property
        </div>
        {scope.includeAll && (
          <>
            <ScopeMenuItem
              label="All properties"
              count={scopeCount(scope.counts, null)}
              checked={scope.activePropertyId === null}
              withGlyph
              onSelect={() => scope.onSelect(null)}
            />
            <DropdownMenuSeparator />
          </>
        )}
        {scope.properties.map((property) => (
          <ScopeMenuItem
            key={property.id}
            label={property.name}
            count={scopeCount(scope.counts, property.id)}
            checked={property.id === scope.activePropertyId}
            onSelect={() => scope.onSelect(property.id)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
