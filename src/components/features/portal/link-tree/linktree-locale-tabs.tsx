// Which language a label or title is being written in. A Portal with one
// language has nothing to choose, so it draws nothing. A language the tile has
// no text in says so on its tab, because the guest then reads the primary
// language there.

import { SegmentedControl } from '#/components/ui/segmented-control'
import {
  GUEST_LOCALE_METADATA,
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

export function LinktreeLocaleTabs({
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
      onValueChange={(value) => {
        const next = locales.find((locale) => locale === value)
        if (next !== undefined) onChange(next)
      }}
      options={locales.map((locale) => {
        const { chipLabel, englishName } = GUEST_LOCALE_METADATA[locale]
        const isMissing = missing.includes(locale)
        return {
          value: locale,
          label: isMissing ? `${chipLabel} missing` : chipLabel,
          accessibleLabel: englishName,
        }
      })}
    />
  )
}
