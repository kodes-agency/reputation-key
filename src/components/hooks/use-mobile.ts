import { useViewportBelow } from './use-viewport-below'

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  return useViewportBelow(MOBILE_BREAKPOINT)
}
