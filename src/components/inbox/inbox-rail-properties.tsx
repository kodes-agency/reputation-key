// The queue rail's second axis: which property the work belongs to. Each row
// counts the queue in view, so the queue row and the scope row in view always
// read the same number.
import { useState, type ReactNode } from 'react'
import { Building2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import {
  previewScopeProperties,
  scopeCount,
  type InboxPropertyScope,
} from './inbox-property-scope'

function ScopeRow({
  label,
  icon,
  active,
  count,
  onSelect,
}: Readonly<{
  label: string
  icon?: ReactNode
  active: boolean
  count: number | undefined
  onSelect: () => void
}>) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-current={active ? 'page' : undefined}
      className={cn(
        'h-8 w-full min-w-0 justify-start gap-2 text-[13px] font-medium',
        // A row without a glyph starts its name where the glyph rows start theirs.
        icon ? 'px-2' : 'pr-2.5 pl-[34px]',
        active && 'bg-accent text-foreground',
      )}
      onClick={onSelect}
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </Button>
  )
}

export function InboxRailProperties({ scope }: Readonly<{ scope: InboxPropertyScope }>) {
  const [expanded, setExpanded] = useState(false)
  const { visible, isFolded } = previewScopeProperties(
    scope.properties,
    scope.activePropertyId,
    expanded,
  )
  const canFold = expanded || isFolded

  return (
    <nav aria-label="Properties" className="mt-5">
      <p className="mb-2 px-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        Properties
      </p>
      <div className="space-y-1">
        {scope.includeAll && (
          <ScopeRow
            label="All properties"
            icon={<Building2 className="size-4" aria-hidden="true" />}
            active={scope.activePropertyId === null}
            count={scopeCount(scope.counts, null)}
            onSelect={() => scope.onSelect(null)}
          />
        )}
        {visible.map((property) => (
          <ScopeRow
            key={property.id}
            label={property.name}
            active={property.id === scope.activePropertyId}
            count={scopeCount(scope.counts, property.id)}
            onSelect={() => scope.onSelect(property.id)}
          />
        ))}
        {canFold && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            className="h-8 w-full justify-start gap-1.5 pr-2.5 pl-[34px] text-[13px] font-medium text-muted-foreground"
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? 'Show fewer' : `Show all ${scope.properties.length}`}
            {/* Wrapped so the button's glyph padding rule does not apply. */}
            <span aria-hidden="true">
              {expanded ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </span>
          </Button>
        )}
      </div>
    </nav>
  )
}
