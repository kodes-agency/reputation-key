import { useRef, type ReactNode } from 'react'
import { cn } from '#/lib/utils'

export type BetaFeedbackChoice<TValue extends string> = Readonly<{
  value: TValue
  label: string
  hint?: string
  icon?: ReactNode
}>

type Props<TValue extends string> = Readonly<{
  legend: string
  name: string
  value: TValue
  options: ReadonlyArray<BetaFeedbackChoice<TValue>>
  onChange: (value: TValue) => void
  /** `cards` is the two-up type picker; `rows` is the stacked impact list. */
  layout: 'cards' | 'rows'
  disabled?: boolean
}>

/**
 * A radiogroup with roving focus, used for both the report type and its impact.
 * Native radios were not reachable here: the type picker needs a two-up card
 * with an icon and a hint, and the two groups must behave identically.
 */
export function BetaFeedbackChoiceGroup<TValue extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  layout,
  disabled = false,
}: Props<TValue>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const move = (from: number, delta: number): void => {
    const next = (from + delta + options.length) % options.length
    const option = options[next]
    if (!option) return
    onChange(option.value)
    refs.current[next]?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent, index: number): void => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (step === 0) return
    event.preventDefault()
    move(index, step)
  }

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div
        role="radiogroup"
        aria-label={legend}
        className={cn(
          layout === 'cards' ? 'grid grid-cols-1 gap-2 sm:grid-cols-2' : 'grid gap-1.5',
        )}
      >
        {options.map((option, index) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              ref={(node) => {
                refs.current[index] = node
              }}
              type="button"
              role="radio"
              name={name}
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                'group relative flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-50',
                selected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40 hover:bg-muted/40',
                layout === 'cards' ? 'flex-col gap-2' : 'items-center py-2.5',
              )}
            >
              {option.icon && (
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-md transition-colors',
                    selected
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground',
                  )}
                  aria-hidden="true"
                >
                  {option.icon}
                </span>
              )}
              {!option.icon && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                    selected ? 'border-primary' : 'border-input',
                  )}
                >
                  {selected && <span className="size-2 rounded-full bg-primary" />}
                </span>
              )}
              <span className="min-w-0 space-y-1">
                <span
                  className={cn(
                    'block text-sm',
                    layout === 'cards' ? 'font-medium' : 'font-normal',
                  )}
                >
                  {option.label}
                </span>
                {option.hint && (
                  <span className="block text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
