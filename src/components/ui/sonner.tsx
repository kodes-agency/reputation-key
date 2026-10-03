'use client'

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useResolvedTheme } from '#/components/hooks/use-theme-mode'
import { TOASTER_STYLE } from './toaster-theme'

/**
 * The app's one Toaster. It follows the theme the document shows and paints
 * typed toasts (`richColors`) from the success, info, warning and error tokens
 * (see `toaster-theme.ts`), so a plain `toast()` and a typed one belong to the
 * same family in both themes.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useResolvedTheme()
  return (
    <Sonner
      className="toaster group"
      theme={theme}
      richColors
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={TOASTER_STYLE}
      {...props}
    />
  )
}

export { Toaster }
