// The open tile: its label and line in the chosen language, its icon, and where
// it opens with the approval of that place.

import { useState } from 'react'
import type {
  PortalLinktreeLink,
  PortalLinktreeView,
} from '#/contexts/portal/application/public-api'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { PortalLinkIconKey } from '#/shared/domain/portal-link-icon'
import { LinkAddressForm } from './link-address-form'
import { LinkTextsForm } from './link-texts-form'
import { LinktreeApprovalFact } from './linktree-approval-fact'
import { LinktreeIconPicker } from './linktree-icon-picker'
import { LinktreeLocaleTabs } from './linktree-locale-tabs'
import { linkLocaleChips } from './linktree-rules'
import type { LinktreeMutations } from './use-linktree-mutations'

type Props = Readonly<{
  link: PortalLinktreeLink
  view: Pick<PortalLinktreeView, 'primaryLocale' | 'locales'>
  /** The Portal's languages a manager can write in, primary first. */
  locales: ReadonlyArray<OfferedGuestLocale>
  mutations: LinktreeMutations
  memberNames: ReadonlyMap<string, string>
  /** The refusal of the last address change on this tile, if any. */
  addressError: unknown
  onAddressEdit: () => void
  onIconChange: (key: PortalLinkIconKey) => void
  onCheckAddress: () => void
  canEdit: boolean
}>

export function LinktreeTileEditor({
  link,
  view,
  locales,
  mutations,
  memberNames,
  addressError,
  onAddressEdit,
  onIconChange,
  onCheckAddress,
  canEdit,
}: Props) {
  const primary = locales.find((locale) => locale === view.primaryLocale) ?? locales[0]
  const [chosen, setChosen] = useState<OfferedGuestLocale | null>(null)
  const locale = chosen ?? primary
  if (locale === undefined) return null
  const chips = linkLocaleChips(link, locales)
  const missing = locales.filter(
    (offered) => chips.find((chip) => chip.locale === offered)?.isMissing,
  )

  return (
    <div className="space-y-5">
      <LinktreeLocaleTabs
        aria-label="Label language"
        locales={locales}
        active={locale}
        missing={missing}
        onChange={setChosen}
      />
      <LinkTextsForm
        link={link}
        locales={locales}
        primaryLocale={view.primaryLocale}
        locale={locale}
        save={mutations.saveTexts}
        disabled={!canEdit}
      />
      <div className="space-y-2">
        <p className="text-sm font-medium">Icon</p>
        <LinktreeIconPicker
          value={link.iconKey}
          onChange={onIconChange}
          disabled={!canEdit}
        />
      </div>
      <div className="space-y-2">
        {/* Keyed on the saved address: once the server's form of it is back, the field shows that. */}
        <LinkAddressForm
          key={link.url}
          link={link}
          update={mutations.updateLink}
          error={addressError}
          onEdit={onAddressEdit}
          disabled={!canEdit}
        />
        <LinktreeApprovalFact
          destination={link.destination}
          memberNames={memberNames}
          onCheck={onCheckAddress}
          isChecking={mutations.updateLink.isPending}
          disabled={!canEdit}
        />
      </div>
    </div>
  )
}
