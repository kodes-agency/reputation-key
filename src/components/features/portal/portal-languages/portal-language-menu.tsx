// The "more actions" menu of one language row: make it the fallback, or remove
// it. The fallback language is never removed; another one has to take over first.

import { Ellipsis } from 'lucide-react'
import { Button } from '#/components/ui/button'
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

const ITEM = 'min-h-11 md:min-h-8'

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
        <Button
          variant="ghost"
          size="icon"
          className="size-11 text-muted-foreground md:size-8"
          aria-label={`More actions for ${languageName}`}
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {isFallback ? (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Make another language the fallback to remove this one.
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className={ITEM}>
              Remove language
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem
              className={ITEM}
              onSelect={() => onChange({ kind: 'make_fallback', locale })}
            >
              Make fallback language
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className={ITEM}
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
