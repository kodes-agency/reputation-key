// The title guests read above the tiles, with the switch for the language it is
// written in. Nothing is drawn for a portal that offers no language yet.

import { useState } from 'react'
import type { PortalLinktreeView } from '#/contexts/portal/application/public-api'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import { LinktreeLocaleSwitch } from './linktree-locale-switch'
import { LinktreeTitleForm } from './linktree-title-form'
import type { LinktreeMutations } from './use-linktree-mutations'

type Props = Readonly<{
  view: PortalLinktreeView
  locales: ReadonlyArray<OfferedGuestLocale>
  save: LinktreeMutations['saveSettings']
  disabled: boolean
}>

export function LinktreeTitleBlock({ view, locales, save, disabled }: Props) {
  const [choice, setChoice] = useState<OfferedGuestLocale | null>(null)
  const locale = choice ?? locales[0]
  if (locale === undefined) return null
  return (
    <div className="space-y-2">
      <LinktreeLocaleSwitch
        aria-label="Title language"
        locales={locales}
        active={locale}
        onChange={setChoice}
      />
      <LinktreeTitleForm
        portalId={view.portalId}
        titles={view.titles}
        locales={locales}
        locale={locale}
        save={save}
        disabled={disabled}
      />
    </div>
  )
}
