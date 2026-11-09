'use client'

import { Loader2Icon } from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useResolvedTheme } from '#/components/hooks/use-theme-mode'
import { TONE_ICON } from './tone'
import type { CSSProperties } from 'react'

/**
 * The app's one Toaster. It follows the document's theme and paints typed toasts
 * (`richColors`) from the success, info, warning and error tokens (`TOASTER_STYLE`).
 * A typed toast wears its tone's icon (`TONE_ICON`); only the spinner is the
 * Toaster's own.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useResolvedTheme()
  return (
    <Sonner
      className="toaster group"
      theme={theme}
      richColors
      icons={{
        success: <TONE_ICON.positive className="size-4" />,
        info: <TONE_ICON.info className="size-4" />,
        warning: <TONE_ICON.warn className="size-4" />,
        error: <TONE_ICON.negative className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={TOASTER_STYLE}
      {...props}
    />
  )
}

export { Toaster }

/**
 * What the Toaster paints from. Sonner draws a typed toast from its own hsl()
 * palette and exposes the colours as CSS variables (`--success-bg`, `--error-text`…).
 * Setting those to the app's tokens makes a toast follow `.dark` and mean what the
 * same colour means in an Alert. Each tone is a tinted surface (`-bg`), the
 * text-grade ink on it (`-text`) and an edge (`-border`); `toaster-theme.test.ts`
 * measures the pairs at 4.5:1 in both themes. A plain object literal: the Toaster
 * is in the first-paint closure.
 */
export const TOASTER_STYLE = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--border-radius': 'var(--radius)',
  // Sonner's close-button hover reads these grays.
  '--gray2': 'var(--muted)',
  '--gray5': 'var(--border)',
  '--success-bg': 'var(--success-muted)',
  '--success-text': 'var(--positive)',
  '--success-border': 'color-mix(in oklab, var(--success) 40%, transparent)',
  '--info-bg': 'var(--accent-muted)',
  '--info-text': 'var(--link)',
  '--info-border': 'color-mix(in oklab, var(--link) 25%, transparent)',
  '--warning-bg': 'var(--warn-muted)',
  '--warning-text': 'var(--warn)',
  '--warning-border': 'var(--warn-line)',
  '--error-bg': 'var(--destructive-muted)',
  '--error-text': 'var(--negative)',
  '--error-border': 'color-mix(in oklab, var(--destructive) 40%, transparent)',
} as CSSProperties
