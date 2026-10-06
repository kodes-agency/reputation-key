// PROTOTYPE — the page header with its controls beside it: title and description on the
// left, the property switcher and "Jump to" on the right from `lg`. On a phone the
// controls are one full-width row under the header, so the switcher is never squeezed
// by a menu button that wrapped below it.
import type { ReactNode } from 'react'

export function HeaderRow({
  header,
  controls,
}: Readonly<{ header: ReactNode; controls: ReactNode }>) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
      <div className="min-w-0">{header}</div>
      {controls === null ? null : (
        <div className="flex w-full items-center gap-2 lg:w-auto lg:shrink-0">
          {controls}
        </div>
      )}
    </div>
  )
}
