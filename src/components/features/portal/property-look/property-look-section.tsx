// One row of the Property look page (board 09): the title and a line of help on
// the left, the controls on the right. Stacked on a phone.
import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

type Props = Readonly<{
  /** Names the section for assistive technology and is its visible title. */
  title: string
  hint: ReactNode
  /** Rows after the first are set off by a rule. */
  isFirst?: boolean
  children: ReactNode
}>

export function PropertyLookSection({ title, hint, isFirst = false, children }: Props) {
  const headingId = `property-look-${title.toLowerCase().replaceAll(/[^a-z]+/gu, '-')}`
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'grid gap-3 py-5 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-6',
        !isFirst && 'border-t',
      )}
    >
      <div className="space-y-1">
        <h2 id={headingId} className="text-sm font-semibold">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </section>
  )
}
