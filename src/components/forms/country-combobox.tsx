import { useMemo } from 'react'
import { SearchableSelect } from './searchable-select'

type Props = Readonly<{
  id?: string
  value: string
  onValueChange: (countryCode: string) => void
  countries: readonly Readonly<{ code: string; label: string }>[]
  placeholder?: string
  disabled?: boolean
  className?: string
  onBlur?: () => void
  'aria-label'?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}>

/** A searchable country picker; a search matches the name or the two-letter code. */
export function CountryCombobox({
  countries,
  placeholder = 'Choose a country',
  ...props
}: Props) {
  const groups = useMemo(
    () => [
      {
        options: countries.map((country) => ({
          value: country.code,
          label: `${country.label} (${country.code})`,
          keywords: [country.code],
        })),
      },
    ],
    [countries],
  )
  return (
    <SearchableSelect
      {...props}
      groups={groups}
      placeholder={placeholder}
      searchPlaceholder="Search a country"
      emptyMessage="No country matches."
    />
  )
}
