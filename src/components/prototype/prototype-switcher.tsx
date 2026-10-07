// PROTOTYPE — a generic bottom-centre switcher for UI prototypes: ← [A — name] →
// cycles a variant search param, and any number of toggle groups set other search
// params (fixtures). It writes the URL with `replace`, so a prototype is shareable
// and reload-stable, and it is never drawn in a production build.
//
// The ← and → keys cycle the variant unless the focus is in a field, a menu or any
// other control that uses the arrow keys itself.
import { useCallback, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export type PrototypeChoice = Readonly<{
  value: string
  /** What the segment prints. */
  label: string
  /** For a variant: its name, printed beside the key (`A — Editor rail`). */
  name?: string
}>

export type PrototypeToggle = Readonly<{
  param: string
  label: string
  current: string
  choices: readonly PrototypeChoice[]
}>

type Props = Readonly<{
  variants: Readonly<{
    /** The search param that holds the variant. */
    param?: string
    current: string
    choices: readonly PrototypeChoice[]
  }>
  /** Fixture toggles: one search param each, one segment per choice. */
  toggles?: readonly PrototypeToggle[]
}>

/** Focus in any of these keeps the arrow keys for itself. */
const OWNS_ARROW_KEYS = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="radiogroup"]',
  '[role="slider"]',
  '[role="tablist"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="combobox"]',
].join(',')

const SEGMENT =
  'rounded-full px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring'

function Switcher({ variants, toggles = [] }: Props) {
  const navigate = useNavigate()
  const variantParam = variants.param ?? 'variant'
  const { current, choices } = variants

  const setParam = useCallback(
    (param: string, value: string) => {
      void navigate({
        to: '.',
        // A number keeps the URL readable (?props=60, not ?props=%2260%22).
        search: ((previous: Record<string, unknown>) => ({
          ...previous,
          [param]: /^\d+$/.test(value) ? Number(value) : value,
        })) as never,
        replace: true,
      })
    },
    [navigate],
  )

  const cycle = useCallback(
    (step: 1 | -1) => {
      if (choices.length === 0) return
      const index = Math.max(
        0,
        choices.findIndex((choice) => choice.value === current),
      )
      const next = choices[(index + step + choices.length) % choices.length]
      if (next !== undefined) setParam(variantParam, next.value)
    },
    [choices, current, setParam, variantParam],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const focused = document.activeElement
      if (focused instanceof HTMLElement && focused.closest(OWNS_ARROW_KEYS)) return
      cycle(event.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cycle])

  const active = choices.find((choice) => choice.value === current)
  const label = active?.name ? `${current} — ${active.name}` : current

  return (
    <div
      role="toolbar"
      aria-label="Prototype controls"
      data-prototype-switcher
      className="fixed bottom-4 left-1/2 z-[100] flex w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-1 gap-y-1 rounded-3xl bg-foreground p-1 text-background shadow-lg sm:rounded-full"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous variant"
          onClick={() => cycle(-1)}
          className={`${SEGMENT} hover:bg-background/20`}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <span
          aria-live="polite"
          className="min-w-28 shrink-0 px-1 text-center text-sm font-semibold whitespace-nowrap"
        >
          {label}
        </span>
        <button
          type="button"
          aria-label="Next variant"
          onClick={() => cycle(1)}
          className={`${SEGMENT} hover:bg-background/20`}
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
      {toggles.map((toggle) => (
        <div
          key={toggle.param}
          role="group"
          aria-label={toggle.label}
          className="flex items-center gap-0.5 sm:ml-1 sm:border-l sm:border-background/30 sm:pl-2"
        >
          <span className="hidden pr-1 text-xs whitespace-nowrap opacity-70 sm:inline">
            {toggle.label}
          </span>
          {toggle.choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={choice.value === toggle.current}
              onClick={() => setParam(toggle.param, choice.value)}
              className={`${SEGMENT} whitespace-nowrap ${
                choice.value === toggle.current
                  ? 'bg-background text-foreground'
                  : 'hover:bg-background/20'
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Hidden in production builds, so a stray prototype merge cannot ship the bar. */
export function PrototypeSwitcher(props: Props) {
  if (import.meta.env.PROD) return null
  return <Switcher {...props} />
}
