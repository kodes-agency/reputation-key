// Languages offered by default (board 09): what a new portal starts with. Each
// portal still picks its own, so changing this never touches a portal that
// exists. The first language is the fallback; the others can be removed or made
// the fallback. The rules are the portal's own Languages section's, so a
// language is offered here exactly when it could be added there.
import { X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import { PortalLanguageAddMenu } from '../portal-languages/portal-language-add-menu'
import {
  addableLanguages,
  applyLanguageChange,
  hasLaterLanguages,
  languageDisplayName,
  type PortalLanguageChange,
} from '../portal-languages/portal-languages-rules'
import { PropertyLookSection } from './property-look-section'
import { languageSetOf } from './property-look-rules'
import { IconButton } from '#/components/ui/icon-button'

type Props = Readonly<{
  locales: readonly OfferedGuestLocale[]
  onChange: (locales: readonly OfferedGuestLocale[]) => void
  disabled: boolean
}>

export function PropertyLookLanguagesSection({ locales, onChange, disabled }: Props) {
  const set = languageSetOf(locales)
  const [fallback = 'en', ...others] = locales
  const apply = (change: PortalLanguageChange) => {
    const next = applyLanguageChange(set, change)
    if (next) onChange([next.primary, ...next.additional])
  }
  return (
    <PropertyLookSection
      title="Languages offered by default"
      hint="New portals start with these."
    >
      <ul className="flex flex-wrap items-center gap-2" aria-label="Default languages">
        <li className="flex h-9 items-center rounded-md border bg-card px-3 text-sm">
          <span lang={fallback}>{languageDisplayName(fallback).native}</span>
          <span className="ml-2 text-xs text-muted-foreground">Fallback</span>
        </li>
        {others.map((locale) => {
          const name = languageDisplayName(locale)
          return (
            <li
              key={locale}
              className="flex min-h-9 items-center gap-2 rounded-md border bg-card pl-3 text-sm"
            >
              <span lang={locale}>{name.native}</span>
              {disabled ? null : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    touch
                    aria-label={`Make ${name.english} the fallback`}
                    onClick={() => apply({ kind: 'make_fallback', locale })}
                  >
                    Make fallback
                  </Button>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    touch
                    className="mr-1"
                    label={`Remove ${name.english}`}
                    onClick={() => apply({ kind: 'remove', locale })}
                  >
                    <X aria-hidden />
                  </IconButton>
                </>
              )}
            </li>
          )
        })}
        {disabled ? null : (
          <li>
            <PortalLanguageAddMenu
              addable={addableLanguages(set)}
              hasLater={hasLaterLanguages()}
              onChange={apply}
            />
          </li>
        )}
      </ul>
      <p className="text-sm text-muted-foreground">
        {languageDisplayName(fallback).english} is the fallback. Each portal can add or
        remove languages; with only one, guests see no language switch.
      </p>
    </PropertyLookSection>
  )
}
