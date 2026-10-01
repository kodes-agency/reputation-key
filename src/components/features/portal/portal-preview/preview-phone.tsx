// The frames the preview draws a guest page in. The page is laid out at a real
// phone's width (390 px), so its type, glass and tiles are the real ones, and
// is then scaled down with a transform: that keeps its geometry exact and
// costs the compositor, not layout.

import type { CSSProperties, ReactNode } from 'react'

/** The page's own box: a phone, as the guest boards are measured. */
const PREVIEW_PAGE = { width: 390, height: 844 } as const

const PAGE_RADIUS = 28
const BEZEL = 8

/** The outer size of the phone at `scale`, for a placeholder of the same size. */
export function phoneFrameSize(scale: number): { width: number; height: number } {
  return {
    width: PREVIEW_PAGE.width * scale + BEZEL * 2,
    height: PREVIEW_PAGE.height * scale + BEZEL * 2,
  }
}

type ScaledPageProps = Readonly<{
  scale: number
  /**
   * The page scrolls inside its frame (the main phone); a thumbnail does not.
   * A scrolling frame is a focusable region named `label`, so the keyboard can
   * scroll it even while its content is inert.
   */
  scrollable?: boolean
  label?: string
  children: ReactNode
}>

export function ScaledPage({
  scale,
  scrollable = false,
  label,
  children,
}: ScaledPageProps) {
  const outer: CSSProperties = {
    width: PREVIEW_PAGE.width * scale,
    height: PREVIEW_PAGE.height * scale,
    overflow: 'hidden',
    borderRadius: PAGE_RADIUS * scale,
    // A rounded, clipped, transformed box needs its own layer to clip children.
    isolation: 'isolate',
  }
  const inner: CSSProperties = {
    width: PREVIEW_PAGE.width,
    height: PREVIEW_PAGE.height,
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    overflowX: 'hidden',
    overflowY: scrollable ? 'auto' : 'hidden',
    scrollbarWidth: 'none',
  }
  return (
    <div style={outer}>
      {scrollable ? (
        <div style={inner} role="region" aria-label={label} tabIndex={0}>
          {children}
        </div>
      ) : (
        <div style={inner}>{children}</div>
      )}
    </div>
  )
}

/** The phone: a dark bezel around one scaled, scrollable page. */
export function PreviewPhone({
  scale,
  label,
  children,
}: Readonly<{ scale: number; label: string; children: ReactNode }>) {
  const bezel: CSSProperties = {
    padding: BEZEL,
    borderRadius: PAGE_RADIUS * scale + BEZEL,
    background: '#0c0f0e',
    boxShadow: '0 18px 40px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.12)',
    width: 'fit-content',
  }
  return (
    <div style={bezel}>
      <ScaledPage scale={scale} scrollable label={label}>
        {children}
      </ScaledPage>
    </div>
  )
}
