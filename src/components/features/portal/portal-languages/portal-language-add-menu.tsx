// "Add language": the launch languages whose guest copy exists and that the
// Portal does not offer yet, then a disabled note that more come later.

import { ChevronDown, Plus } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { languageDisplayName, type PortalLanguageChange } from './portal-languages-rules'

type Props = Readonly<{
  addable: ReadonlyArray<GuestLocale>
  hasLater: boolean
  onChange: (change: PortalLanguageChange) => void
}>

export function PortalLanguageAddMenu({ addable, hasLater, onChange }: Props) {
  if (addable.length === 0 && !hasLater) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="min-h-11 md:min-h-9">
          <Plus aria-hidden="true" />
          Add language
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        {addable.map((locale) => {
          const name = languageDisplayName(locale)
          return (
            <DropdownMenuItem
              key={locale}
              className="min-h-11 justify-between gap-6 md:min-h-8"
              onSelect={() => onChange({ kind: 'add', locale })}
            >
              <span lang={locale}>{name.native}</span>
              <span className="text-xs text-muted-foreground">{name.english}</span>
            </DropdownMenuItem>
          )
        })}
        {addable.length > 0 && hasLater ? <DropdownMenuSeparator /> : null}
        {hasLater ? (
          <DropdownMenuItem disabled className="min-h-11 md:min-h-8">
            More languages later
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
