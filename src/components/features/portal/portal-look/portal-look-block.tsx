// One of the three groups of a portal's look (Photo, Colours, Name and logo): its
// name as a part of the Look section, a line on what it is, and the group's
// controls beneath. Rows after the first are set off by a rule, as the Property
// look page sets off its own.
import { useId, type ReactNode } from 'react'
import { SectionTitle } from '#/components/ui/section-title'
import { cn } from '#/lib/utils'

type Props = Readonly<{
  title: string
  hint: string
  /** The first group has no rule above it. */
  isFirst?: boolean
  children: ReactNode
}>

export function PortalLookBlock({ title, hint, isFirst = false, children }: Props) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className={cn('space-y-3 py-5', !isFirst && 'border-t')}
    >
      <div className="space-y-0.5">
        <SectionTitle level={3} id={headingId}>
          {title}
        </SectionTitle>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  )
}
