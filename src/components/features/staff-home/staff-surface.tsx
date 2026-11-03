import type { CSSProperties, ReactNode } from 'react'
import { QR_INK, QR_PAPER } from '#/components/features/portal/portal-share/portal-qr'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { cn } from '#/lib/utils'
import { STAFF_SURFACE_CSS } from './staff-surface-styles'
import { staffFieldColour, staffLookVariables } from './staff-look'
import type { StaffParticipation } from './types'

/**
 * The staff phone. The Code tab always sits on the hotel's dark colour, so the
 * white pass is the brightest thing a guest sees; everything else follows the
 * phone's own light or dark setting.
 */
export function StaffSurface({
  participation,
  tab,
  embedded = false,
  children,
}: Readonly<{
  participation?: StaffParticipation
  tab?: 'code' | 'results'
  embedded?: boolean
  children: ReactNode
}>) {
  const style = {
    ...staffLookVariables(participation?.look),
    '--staff-paper': QR_PAPER,
    '--staff-ink': QR_INK,
  } as CSSProperties
  // `/my` is outside the manager shell, so its surface is the page's main landmark.
  const Surface = embedded ? 'div' : 'main'
  return (
    <Surface
      className={cn('staff-phone', tab === 'code' && 'dark')}
      data-tab={tab}
      data-embedded={embedded}
      style={style}
    >
      <style href="staff-surface" precedence="default">
        {STAFF_SURFACE_CSS}
      </style>
      {/* Here rather than in the routes' heads, which every page's first load carries. */}
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      {tab === 'code' && !embedded ? (
        <meta name="theme-color" content={staffFieldColour(participation?.look)} />
      ) : null}
      {children}
    </Surface>
  )
}
