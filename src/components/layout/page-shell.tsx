import type { ReactNode } from 'react'

type Props = Readonly<{
  children: ReactNode
}>

/**
 * Uniform page wrapper for all non-dashboard authenticated pages.
 * Provides centered max-width container with consistent vertical spacing.
 * Padding (px-4/py-5 mobile, px-6/py-8 desktop) comes from <main>.
 */
export function PageShell({ children }: Props) {
  return <div className="mx-auto w-full max-w-5xl space-y-5 md:space-y-8">{children}</div>
}
