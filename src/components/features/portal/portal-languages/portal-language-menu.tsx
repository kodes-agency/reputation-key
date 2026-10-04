// The "more actions" menu of one language row: make it the fallback, or remove
// it. The fallback language is never removed; another one has to take over first.

import {
  RowActionsItem,
  RowActionsLabel,
  RowActionsMenu,
  RowActionsSeparator,
} from '#/components/ui/row-actions-menu'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PortalLanguageChange } from './portal-languages-rules'

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
    <RowActionsMenu name={languageName}>
      {isFallback ? (
        <>
          <RowActionsLabel className="text-xs font-normal text-muted-foreground">
            Make another language the fallback to remove this one.
          </RowActionsLabel>
          <RowActionsSeparator />
          <RowActionsItem disabled>Remove language</RowActionsItem>
        </>
      ) : (
        <>
          <RowActionsItem onSelect={() => onChange({ kind: 'make_fallback', locale })}>
            Make fallback language
          </RowActionsItem>
          <RowActionsSeparator />
          {/* A draft's language comes back with "Add language", so it needs no dialog. */}
          <RowActionsItem
            destructive
            onSelect={() => onChange({ kind: 'remove', locale })}
          >
            Remove language
          </RowActionsItem>
        </>
      )}
    </RowActionsMenu>
  )
}
