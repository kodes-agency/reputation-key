import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

/** A trailing figure: tabular, muted, red only when it is urgent. */
export function NavCount({
  tone = 'default',
  className,
  children,
}: Readonly<{
  tone?: 'default' | 'negative'
  className?: string
  children: ReactNode
}>) {
  return (
    <span
      className={cn(
        'text-xs tabular-nums',
        tone === 'negative' ? 'text-negative' : 'text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}
