// The checklist of a property's portals in the group dialogs (board 12): one
// section per place a portal is now, a checkbox and the name, a small fact for a
// draft, and under a ticked portal that is in another group the note that it
// moves and that its results so far stay there.
import { Checkbox } from '#/components/ui/checkbox'
import { cn } from '#/lib/utils'
import {
  toggleSelection,
  type ChecklistPortal,
  type ChecklistSection,
} from './portal-group-checklist'

type Props = Readonly<{
  sections: readonly ChecklistSection[]
  selected: readonly string[]
  onChange: (selected: readonly string[]) => void
  disabled?: boolean
  /** Names the list for a screen reader. */
  label: string
}>

function PortalRow({
  portal,
  checked,
  disabled,
  onToggle,
}: Readonly<{
  portal: ChecklistPortal
  checked: boolean
  disabled: boolean
  onToggle: (checked: boolean) => void
}>) {
  const id = `group-portal-${portal.id}`
  return (
    <li className="border-t first:border-t-0">
      <label
        htmlFor={id}
        className={cn(
          'flex min-h-11 cursor-pointer flex-col justify-center gap-0.5 px-3 py-2 hover:bg-muted/40',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <span className="flex items-center gap-3">
          <Checkbox
            id={id}
            checked={checked}
            disabled={disabled}
            onCheckedChange={(value) => onToggle(value === true)}
          />
          <span className="min-w-0 truncate text-sm">{portal.name}</span>
          {portal.fact ? (
            <span className="text-xs text-muted-foreground">{portal.fact}</span>
          ) : null}
        </span>
        {checked && portal.movesFrom ? (
          <span className="pl-7 text-xs text-muted-foreground">
            Moves from {portal.movesFrom}. Its results so far stay with {portal.movesFrom}
            .
          </span>
        ) : null}
      </label>
    </li>
  )
}

export function PortalGroupChecklistField({
  sections,
  selected,
  onChange,
  disabled = false,
  label,
}: Props) {
  if (sections.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
        There are no other portals at this property to add.
      </p>
    )
  }
  return (
    <div
      role="group"
      aria-label={label}
      className="max-h-[min(22rem,40dvh)] overflow-y-auto rounded-lg border"
    >
      {sections.map((section) => (
        <section key={section.key} aria-label={section.label}>
          <h3 className="sticky top-0 border-b bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
            {section.label}
          </h3>
          <ul>
            {section.portals.map((portal) => (
              <PortalRow
                key={portal.id}
                portal={portal}
                checked={selected.includes(portal.id)}
                disabled={disabled}
                onToggle={(checked) =>
                  onChange(toggleSelection(selected, portal.id, checked))
                }
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
