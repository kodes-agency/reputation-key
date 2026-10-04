// Which language a label or title is being written in. A Portal with one
// language has nothing to choose, so it draws nothing. A language the tile has
// no text in says so on its segment, because the guest then reads the primary
// language there. It is a SegmentedControl (a radio group: choosing a language
// swaps no panel), so it is a switch, not tabs.

import { SegmentedControl } from '#/components/ui/segmented-control'
import {
  GUEST_LOCALE_METADATA,
  adminLanguageCode,
  type OfferedGuestLocale,
} from '#/shared/domain/guest-locale'

type Props = Readonly<{
  locales: ReadonlyArray<OfferedGuestLocale>
  active: OfferedGuestLocale
  onChange: (locale: OfferedGuestLocale) => void
  /** Languages with nothing written yet. */
  missing?: ReadonlyArray<OfferedGuestLocale>
  'aria-label': string
  disabled?: boolean
}>

export function LinktreeLocaleSwitch({
  locales,
  active,
  onChange,
  missing = [],
  disabled,
  ...naming
}: Props) {
  if (locales.length < 2) return null
  return (
    <SegmentedControl
      aria-label={naming['aria-label']}
      value={active}
      disabled={disabled}
      // Six languages with "missing" on five is wider than a phone: wrap.
      className="max-w-full flex-wrap"
      onValueChange={(value) => {
        const next = locales.find((locale) => locale === value)
        if (next !== undefined) onChange(next)
      }}
      options={locales.map((locale) => {
        const { englishName } = GUEST_LOCALE_METADATA[locale]
        const code = adminLanguageCode(locale)
        const isMissing = missing.includes(locale)
        return {
          value: locale,
          label: isMissing ? `${code} missing` : code,
          accessibleLabel: englishName,
        }
      })}
    />
  )
}
