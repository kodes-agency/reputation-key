// BETA-2 B2.5: Reduced motion utilities.
//
// Respects prefers-reduced-motion: disables non-essential animations,
// transitions, and parallax. Essential loading indicators (skeleton
// pulse, progress bars) remain but are simplified.
//
// Usage in components:
//   const prefersReducedMotion = usePrefersReducedMotion()
//   <animate-spin className={prefersReducedMotion ? '' : 'animate-spin'} />

import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Hook that returns true when the user has requested reduced motion.
 * Updates reactively when the preference changes.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(QUERY)
    setReduced(media.matches)

    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [])

  return reduced
}

/**
 * CSS class helper: returns the animation class only when motion is allowed.
 * Usage: <div className={motionClass('animate-spin')} />
 */
export function useMotionClass(): (className: string) => string {
  const reduced = usePrefersReducedMotion()
  return (className: string) => (reduced ? '' : className)
}

/**
 * Global reduced-motion CSS overrides.
 * Add to the root stylesheet or a <style> tag to disable all non-essential
 * motion when prefers-reduced-motion: reduce is active.
 */
export const REDUCED_MOTION_CSS = `
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
` as const
