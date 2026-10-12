'use client'

import { Loader2Icon } from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useResolvedTheme } from '#/components/hooks/use-theme-mode'
import { TONE_ICON } from './tone'
import { TOASTER_STYLE } from './toaster-theme'

/**
 * The app's one Toaster. It follows the theme the document shows and paints
 * typed toasts (`richColors`) from the success, info, warning and error tokens
 * (see `toaster-theme.ts`), so a plain `toast()` and a typed one belong to the
 * same family in both themes. A typed toast wears the icon its tone wears in an
 * Alert or a status pill (`TONE_ICON`), so a failure is the same glyph wherever
 * it is told; only the spinner is the Toaster's own.
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
