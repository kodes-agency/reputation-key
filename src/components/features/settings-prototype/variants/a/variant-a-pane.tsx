// PROTOTYPE — variant A. The content pane: a compact header (the section's title and
// one line of purpose, no breadcrumb), then one column left-aligned at 768 px that
// scrolls on its own. The all-properties table and matrix break out of the column.
// On a phone the header is the drill-down's "< Settings" back row, and a card whose
// form has edits pins its Save row to the bottom of the screen.
import { useEffect, useRef } from 'react'
import { BackLink } from '#/components/ui/back-link'
import { cn } from '#/lib/utils'
import type { SettingsPrototypeContext } from '../../settings-prototype-types'
import { purposeOf } from './variant-a-copy'
import { VariantASection } from './variant-a-sections'

/**
 * A card footer whose form has edits (Reset only exists then) stays at the bottom of
 * the phone screen. Spelled out whole so Tailwind finds each class; the offset clears
 * the prototype switcher that floats over the bottom edge in this build.
 */
const STICKY_SAVE_PHONE =
  'max-lg:[&_[data-slot=card-footer]:has([data-slot=form-actions]_button+button)]:sticky max-lg:[&_[data-slot=card-footer]:has([data-slot=form-actions]_button+button)]:bottom-16 max-lg:[&_[data-slot=card-footer]:has([data-slot=form-actions]_button+button)]:z-10 max-lg:[&_[data-slot=card-footer]:has([data-slot=form-actions]_button+button)]:rounded-b-xl max-lg:[&_[data-slot=card-footer]:has([data-slot=form-actions]_button+button)]:border-t max-lg:[&_[data-slot=card-footer]:has([data-slot=form-actions]_button+button)]:bg-card max-lg:[&_[data-slot=card-footer]:has([data-slot=form-actions]_button+button)]:py-3 max-lg:[&_[data-slot=card-footer]:has([data-slot=form-actions]_button+button)]:shadow-md'

export function VariantAPane({
  ctx,
  isPhone,
}: Readonly<{ ctx: SettingsPrototypeContext; isPhone: boolean }>) {
  const { current, property, shape } = ctx
  const scroller = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const scopeKey = `${ctx.state.propertyId ?? 'all'}:${current.key}`
  const wide = current.key === 'overview'

  // A new section starts at its top; on a phone the drill-down hands the focus to
  // its heading so a screen reader starts on the page it just opened.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
    if (isPhone) heading.current?.focus({ preventScroll: true })
  }, [scopeKey, isPhone])

  return (
    <section
      aria-labelledby="settings-a-title"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <header className="shrink-0 border-b px-4 py-3 lg:px-8 lg:py-5">
        {/* The section screen of a phone has no rail, so the page's h1 is here, unseen. */}
        {isPhone ? <h1 className="sr-only">Settings</h1> : null}
        {isPhone ? (
          <BackLink
            to="/settings-prototype"
            search={(previous) => ({ ...previous, section: undefined })}
            label="Settings"
            flush
            className="mb-1"
          />
        ) : null}
        <div className="max-w-3xl space-y-1">
          <h2
            id="settings-a-title"
            ref={heading}
            tabIndex={-1}
            className="text-lg font-semibold tracking-tight outline-none"
          >
            {current.label}
          </h2>
          <p className="text-sm text-muted-foreground">{purposeOf(current.key, shape)}</p>
          {isPhone && property !== null && shape.showPropertySwitcher ? (
            <p className="truncate text-xs font-medium text-foreground">
              {property.name}
            </p>
          ) : null}
        </div>
      </header>
      <div
        ref={scroller}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-4 pt-5 max-lg:scroll-pb-36 lg:px-8 lg:pt-6',
          STICKY_SAVE_PHONE,
        )}
      >
        <div className={cn('space-y-5', wide ? 'max-w-6xl' : 'max-w-3xl')}>
          <VariantASection ctx={ctx} />
        </div>
        {/* Room to scroll the last card clear of the prototype switcher. Not padding: a sticky Save row measures from the content edge. */}
        <div aria-hidden className="h-28 shrink-0" />
      </div>
    </section>
  )
}
