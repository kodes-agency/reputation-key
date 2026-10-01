// New portal — the languages guests can read the page in. Each language is a
// chip that switches on and off; languages the Property does not start with are
// added from a menu. The first language chosen is the fallback.
import { Check, ChevronDown, Plus } from 'lucide-react'
import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  GUEST_LOCALE_METADATA,
  type OfferedGuestLocale,
} from '#/shared/domain/guest-locale'
import { languageChoices, languageNote, toggleLocale } from './portal-new-rules'
import type { PortalNewField } from './portal-new-types'

const CHIP_CLASS =
  'inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50'

function LanguageChip({
  locale,
  selected,
  disabled,
  onToggle,
}: Readonly<{
  locale: OfferedGuestLocale
  selected: boolean
  disabled: boolean
  onToggle: () => void
}>) {
  const Icon = selected ? Check : Plus
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        CHIP_CLASS,
        selected
          ? 'border-primary/50 bg-accent text-(--accent)'
          : 'border-input bg-background text-foreground hover:bg-muted',
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {GUEST_LOCALE_METADATA[locale].nativeName}
    </button>
  )
}

export function PortalNewLanguagesField({
  field,
  defaults,
  disabled,
  onEdited,
}: Readonly<{
  field: PortalNewField<OfferedGuestLocale[]>
  /** The Property's own languages: always drawn as chips. */
  defaults: readonly OfferedGuestLocale[]
  disabled: boolean
  /** Called when the person changes the languages, so a later default no longer replaces them. */
  onEdited: () => void
}>) {
  const selected = field.state.value
  const { chips, addable } = languageChoices(defaults, selected)
  const change = (locale: OfferedGuestLocale) => {
    onEdited()
    field.handleChange(toggleLocale(selected, locale))
  }
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm leading-snug font-medium">Languages</legend>
      <div className="flex flex-wrap gap-2">
        {chips.map((locale) => (
          <LanguageChip
            key={locale}
            locale={locale}
            selected={selected.includes(locale)}
            disabled={disabled}
            onToggle={() => change(locale)}
          />
        ))}
        {addable.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" disabled={disabled}>
                <Plus aria-hidden="true" />
                Add language
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {addable.map((locale) => (
                <DropdownMenuItem key={locale} onSelect={() => change(locale)}>
                  {GUEST_LOCALE_METADATA[locale].nativeName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{languageNote(selected)}</p>
    </fieldset>
  )
}
