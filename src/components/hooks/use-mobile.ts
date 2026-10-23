import { useViewportBelow } from './use-viewport-below'

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  return useViewportBelow(MOBILE_BREAKPOINT)
}

/** Tailwind's `lg`: from here the Share tab shows its print kit's preview beside the section. */
const LARGE_BREAKPOINT = 1024

export function useIsBelowLarge() {
  return useViewportBelow(LARGE_BREAKPOINT)
}
