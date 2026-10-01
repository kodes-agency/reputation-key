import { useId, type KeyboardEvent } from 'react'
import { cn } from '#/lib/utils'
import type { InboxFilterOption } from './inbox-filter-options'

/** Where an arrow, Home or End key moves the choice; null for any other key. */
function targetIndex(key: string, current: number, count: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % count
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/**
 * One choice out of a few, as wrapping pills. A radiogroup rather than a
 * select: on a phone every option is visible and one tap away, and the sheet
 * already owns the vertical scroll a select's own popup would fight.
 */
export function InboxChoiceChips({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string
  value: string
  options: ReadonlyArray<InboxFilterOption>
  onChange: (value: string) => void
}>) {
  const headingId = useId()
  const checkedIndex = options.findIndex((option) => option.value === value)
  const tabbableIndex = checkedIndex === -1 ? 0 : checkedIndex

  // Choosing what is already chosen is not a change: no history entry, no refetch.
  function choose(next: string) {
    if (next !== value) onChange(next)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    // Alt+Arrow is history navigation and Ctrl/Cmd+arrow a browser or OS
    // shortcut: the group must not swallow them.
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const next = targetIndex(event.key, index, options.length)
    const option = next === null ? undefined : options[next]
    if (next === null || option === undefined) return
    event.preventDefault()
    // Arrows move AND select, like a native radio group.
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      .item(next)
      ?.focus()
    choose(option.value)
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-medium">
        {label}
      </h3>
      <div role="radiogroup" aria-labelledby={headingId} className="flex flex-wrap gap-2">
        {options.map((option, index) => {
          const isChecked = index === checkedIndex
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isChecked}
              tabIndex={index === tabbableIndex ? 0 : -1}
              className={cn(
                'inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                // The checked pill is set apart by an accent edge as well as by
                // its tint, which alone is a faint difference from the others.
                isChecked
                  ? 'border-(--accent) bg-accent text-(--accent)'
                  : 'bg-background text-foreground hover:bg-muted',
              )}
              onClick={() => choose(option.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
