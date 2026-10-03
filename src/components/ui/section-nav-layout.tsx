import { createContext, type ReactNode } from 'react'
import { cn } from '#/lib/utils'
import { SECTION_NAV_LAYOUT, type SectionNavFrame } from './section-nav-styles'

/** The frame of the layout a nav sits in; null when it sits in none. */
export const SectionNavFrameContext = createContext<SectionNavFrame | null>(null)

type Props = Readonly<{
  /** `rail` for a full-bleed workspace, `inline` for a page's own content. */
  frame: SectionNavFrame
  /** On the container: a height, for a rail that fills its parent. */
  className?: string
  /** The `SectionNav` and the content it navigates, in that order. */
  children: ReactNode
}>

/**
 * A nav and the content beside it, laid out by the width of the space they share
 * rather than by the window: the sidebar, the preview pane or a collapsed rail
 * change how much room a page has at the same screen width, and a viewport
 * breakpoint cannot see that. The nav is a strip above its content in a narrow
 * space and a list beside it in a wide one.
 *
 * Two elements, because a container cannot restyle itself: the outer one declares
 * the container, the inner one is the layout that changes. A `SectionNav` inside
 * reads its frame from here, so the nav and the layout turn at the same width.
 */
export function SectionNavLayout({ frame, className, children }: Props) {
  const layout = SECTION_NAV_LAYOUT[frame]
  return (
    <SectionNavFrameContext value={frame}>
      <div className={cn('@container', layout.outer, className)}>
        <div className={layout.inner}>{children}</div>
      </div>
    </SectionNavFrameContext>
  )
}
