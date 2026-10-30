import { useId, type ReactNode } from 'react'
import { SectionTitle } from '#/components/ui/section-title'
import { TONE_FILL, TONE_INK, type Tone } from '#/components/ui/tone'
import { cn } from '#/lib/utils'

/** Answer first in the DOM; evidence stacks below it in a narrow page container. */
export function GuestVoiceSection({
  title,
  hint,
  answer,
  aside,
  footer,
  tone = 'neutral',
  children,
}: Readonly<{
  title: string
  hint?: string
  answer?: string
  aside?: ReactNode
  footer?: ReactNode
  tone?: Tone
  children: ReactNode
}>) {
  const headingId = useId()
  if (answer === undefined)
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <SectionTitle id={headingId} tabIndex={-1}>
          {title}
        </SectionTitle>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
        {children}
      </section>
    )
  return (
    <section
      style={{ gridTemplateColumns: '2fr 5fr' }}
      aria-labelledby={headingId}
      className="overflow-hidden rounded-xl border bg-card shadow-xs @3xl:grid"
    >
      <div
        className={cn(
          'flex flex-col items-start min-w-0 gap-3 p-4 border-r',
          TONE_FILL[tone],
        )}
      >
        <SectionTitle id={headingId} tabIndex={-1} className={TONE_INK[tone]}>
          {title}
        </SectionTitle>
        <p className="text-xl leading-tight font-semibold tracking-tight @3xl:text-2xl">
          {answer}
        </p>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
        {aside}
        {footer}
      </div>
      <div className="min-w-0 px-4 py-2">{children}</div>
    </section>
  )
}
export function GuestVoiceNothingHere({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>
}
