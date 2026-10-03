import { useContext, type ComponentType, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { isFullBleedRoute } from './full-bleed-route'
import { FullBleedFrame } from './page-shell'
import { NoticeState } from './route-notice-state'
import { ShellPresence } from './route-page-state'

/**
 * What the app shell route draws for a not-found: the notice, inside a shell.
 *
 * An address no page answers renders inside the route's own layout, so the shell
 * is already there; a not-found a loader threw (a refusal, a missing Property)
 * replaces the layout, so the boundary brings a shell of its own. A full-bleed
 * surface keeps its edge-to-edge frame, so its notice wears the page gutter.
 */
export function ShellNoticeBoundary({
  data,
  shell: Shell,
}: Readonly<{
  data?: unknown
  /** The app shell, handed in so this stays free of the shell's own imports. */
  shell: ComponentType<Readonly<{ children: ReactNode }>>
}>) {
  const shellPresent = useContext(ShellPresence)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const notice = <NoticeState data={data} />
  const state = isFullBleedRoute(pathname) ? (
    <FullBleedFrame scroll>{notice}</FullBleedFrame>
  ) : (
    notice
  )
  return shellPresent ? state : <Shell>{state}</Shell>
}
