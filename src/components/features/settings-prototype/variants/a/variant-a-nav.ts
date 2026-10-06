// PROTOTYPE — variant A. The one thing the shared nav helpers cannot say: on a phone
// the Settings index is "no section in the URL", so a move from the index (picking a
// property) must keep it that way, and the back header must clear the section.
import { useCallback } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import type { SettingsPrototypeHref } from '../../settings-prototype-types'

/** Whether the address names a section: on a phone, the section screen rather than the index. */
export function useHasSectionInUrl(): boolean {
  const section = useSearch({
    from: '/_authenticated/settings-prototype',
    select: (search) => search.section,
  })
  return section !== undefined
}

/** Goes to a row's href; `keepSection: false` lands on the index instead of the section. */
export function useVariantAGoto(): (
  href: SettingsPrototypeHref,
  options: Readonly<{ keepSection: boolean }>,
) => void {
  const navigate = useNavigate()
  return useCallback(
    (href, { keepSection }) => {
      void navigate({
        to: '/settings-prototype',
        search: (previous) => ({
          ...previous,
          ...href,
          ...(keepSection ? {} : { section: undefined }),
        }),
      })
    },
    [navigate],
  )
}
