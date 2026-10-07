// PROTOTYPE — delete after the decision. Navigation inside the prototype: a row's
// `href` is only the part of the URL it changes (section, scope, property), so a link
// merges it into the previous search and the variant, fixtures and role survive.
import { useCallback, type ComponentProps } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { NavLink } from '#/components/ui/nav-link'
import type { SettingsPrototypeHref } from './settings-prototype-types'

type LinkProps = Omit<ComponentProps<'a'>, 'href' | 'ref'> &
  Readonly<{
    href: SettingsPrototypeHref
    /** Whether this link is the open page; drives `aria-current`. */
    current?: boolean
  }>

/** A link to a row of the prototype that keeps the other search params. */
export function SettingsPrototypeLink({ href, current = false, ...rest }: LinkProps) {
  return (
    <NavLink
      to="/settings-prototype"
      search={(previous) => ({ ...previous, ...href })}
      current={current}
      {...rest}
    />
  )
}

/** The same move as a function, for a button or a menu item. */
export function useSettingsPrototypeGoto(): (href: SettingsPrototypeHref) => void {
  const navigate = useNavigate()
  return useCallback(
    (href) => {
      void navigate({
        to: '/settings-prototype',
        search: (previous) => ({ ...previous, ...href }),
      })
    },
    [navigate],
  )
}
