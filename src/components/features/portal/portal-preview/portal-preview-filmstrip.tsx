// The guest states beside the phone (under it on a narrow screen): arrival, after a low rating, after a high
// one, and the note sent. Each thumbnail is the real page at a small scale, in
// that state; choosing one shows it in the phone. Thumbnails are pictures, so
// they are inert: only the buttons around them take focus.

import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'
import type {
  PreviewPageState,
  PreviewStateId,
  PreviewStateOption,
} from './portal-preview-states'
import { ScaledPage } from './preview-phone'

const THUMBNAIL_SCALE = 0.15

type Props = Readonly<{
  options: readonly PreviewStateOption[]
  active: PreviewStateId
  onSelect: (id: PreviewStateId) => void
  /** Draws the page in a state. */
  renderPage: (state: PreviewPageState) => ReactNode
}>

export function PortalPreviewFilmstrip({ options, active, onSelect, renderPage }: Props) {
  return (
    <ul
      aria-label="Guest states"
      className="flex flex-wrap justify-center gap-1 sm:flex-col sm:flex-nowrap sm:justify-start"
    >
      {options.map((option) => {
        const isActive = option.id === active
        return (
          <li key={option.id} className="flex flex-col items-center gap-1 p-1">
            {/* The button overlays the thumbnail instead of wrapping it: the page
                holds buttons of its own, and a button cannot contain one. */}
            <span className="relative block">
              <span
                className={cn(
                  'block rounded-[8px] ring-2 ring-offset-1 ring-offset-background transition-shadow',
                  isActive ? 'ring-primary' : 'ring-border',
                )}
              >
                <span aria-hidden="true" inert className="block">
                  <ScaledPage scale={THUMBNAIL_SCALE}>
                    {renderPage(option.state)}
                  </ScaledPage>
                </span>
              </span>
              <button
                type="button"
                aria-pressed={isActive}
                aria-label={option.name}
                onClick={() => onSelect(option.id)}
                className="absolute inset-0 rounded-[8px] outline-none hover:bg-foreground/5 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'text-xs',
                isActive ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {option.label}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
