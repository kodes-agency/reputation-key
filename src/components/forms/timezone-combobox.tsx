import { useMemo } from 'react'
import { timezonesForCountry } from '#/shared/domain/country-timezones'
import { VALID_TIMEZONES } from '#/shared/domain/timezones'
import { describeTimezone, timezoneSearchTerms } from '#/shared/timezone-display'
import {
  SearchableSelect,
  type SearchableSelectGroup,
  type SearchableSelectOption,
} from './searchable-select'

type Props = Readonly<{
  id?: string
  value: string
  onValueChange: (timezone: string) => void
  /** The zones of this country are offered first. */
  countryCode?: string | null
  placeholder?: string
  disabled?: boolean
  className?: string
  onBlur?: () => void
  'aria-label'?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}>

const regionNames =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null

// Offsets are read once per zone for the life of the page: a list open across a
// daylight-saving change can show the old offset until the next load.
const options = new Map<string, SearchableSelectOption>()

function timezoneOption(timezone: string): SearchableSelectOption {
  const cached = options.get(timezone)
  if (cached) return cached
  const display = describeTimezone(timezone)
  const option = {
    value: timezone,
    label: display.label,
    description: display.region ?? undefined,
    keywords: timezoneSearchTerms(display),
  }
  options.set(timezone, option)
  return option
}

function countryName(code: string): string {
  try {
    return regionNames?.of(code) ?? code
  } catch {
    return code
  }
}

function timezoneGroups(countryCode: string | null | undefined) {
  const inCountry = countryCode ? timezonesForCountry(countryCode) : []
  const all: SearchableSelectGroup = { options: VALID_TIMEZONES.map(timezoneOption) }
  if (!countryCode || inCountry.length === 0) return [all]
  const suggested = new Set(inCountry)
  return [
    { heading: `In ${countryName(countryCode)}`, options: inCountry.map(timezoneOption) },
    {
      heading: 'All timezones',
      options: all.options.filter((option) => !suggested.has(option.value)),
    },
  ]
}

/** A searchable timezone picker that reads "New York (UTC−4)", never "America/New_York". */
export function TimezoneCombobox({
  countryCode,
  placeholder = 'Choose a timezone',
  ...props
}: Props) {
  const groups = useMemo(() => timezoneGroups(countryCode), [countryCode])
  return (
    <SearchableSelect
      {...props}
      groups={groups}
      placeholder={placeholder}
      searchPlaceholder="Search a city, region or UTC offset"
      emptyMessage="No timezone matches."
    />
  )
}
