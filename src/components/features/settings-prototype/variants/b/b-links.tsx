// PROTOTYPE — variant B navigation. A link changes only the part of the URL it names
// (section, scope, property) and keeps the rest, so the variant, the fixtures and the
// role survive every move. Back to Settings is `{ section: undefined }`.
import { useCallback, type ComponentProps } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { NavLink } from '#/components/ui/nav-link'
import type { BTarget } from './b-model'

type LinkProps = Omit<ComponentProps<'a'>, 'href' | 'ref'> &
  Readonly<{
    go: BTarget
    /** Whether this link is the open page; drives `aria-current`. */
    current?: boolean
  }>

export function BLink({ go, current = false, ...rest }: LinkProps) {
  return (
    <NavLink
      to="/settings-prototype"
      search={(previous) => ({ ...previous, ...go })}
      current={current}
      {...rest}
    />
  )
}

/** The same move as a function, for a picker or a menu item. */
export function useGotoB(): (target: BTarget) => void {
  const navigate = useNavigate()
  return useCallback(
    (go) => {
      void navigate({
        to: '/settings-prototype',
        search: (previous) => ({ ...previous, ...go }),
      })
    },
    [navigate],
  )
}

/** The home page: no section. */
export const HOME_TARGET: BTarget = { section: undefined }
