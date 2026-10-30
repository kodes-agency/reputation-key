import { useId, type ReactNode } from 'react'

/**
 * One section of the page: a region named by its h2, with a line under it that says
 * what the section is for. The sections are not cards of their own; what is in them is.
 */
export function GuestVoiceSection({
  title,
  hint,
  children,
}: Readonly<{ title: string; hint?: string; children: ReactNode }>) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {hint === undefined ? null : (
          <p className="text-sm text-muted-foreground">{hint}</p>
        )}
      </div>
      {children}
    </section>
  )
}

/** A line that says a section has nothing in it, in the section's place. */
export function GuestVoiceNothingHere({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}
