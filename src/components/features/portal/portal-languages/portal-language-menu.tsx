// The "more actions" menu of one language row: make it the fallback, or remove
// it. The fallback language is never removed; another one has to take over first.

import { Ellipsis } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PortalLanguageChange } from './portal-languages-rules'
import { IconButton } from '#/components/ui/icon-button'

type Props = Readonly<{
  locale: GuestLocale
  languageName: string
  isFallback: boolean
  onChange: (change: PortalLanguageChange) => void
}>

export function PortalLanguageMenu({
  locale,
  languageName,
  isFallback,
  onChange,
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size="icon-sm"
          tooltip={false}
          className="text-muted-foreground"
          label={`More actions for ${languageName}`}
        >
          <Ellipsis aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {isFallback ? (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Make another language the fallback to remove this one.
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Remove language</DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem
              onSelect={() => onChange({ kind: 'make_fallback', locale })}
            >
              Make fallback language
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onChange({ kind: 'remove', locale })}
            >
              Remove language
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
