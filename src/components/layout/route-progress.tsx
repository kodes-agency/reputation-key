import { useEffect, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'

/**
 * How long a navigation may take before the bar appears. A page that answers in
 * the blink of an eye never shows it, so a fast click stays calm; one that makes
 * the person wait gets a sign that the click was heard.
 */
export const ROUTE_PROGRESS_DELAY_MS = 150

/**
 * Calls `show` once `delayMs` has passed, unless the returned function is called
 * first. The timing rule of the bar, kept apart from React so it is tested alone.
 */
export function showAfterDelay(show: () => void, delayMs: number): () => void {
  const timer = setTimeout(show, delayMs)
  return () => clearTimeout(timer)
}

/**
 * A 2 px bar on the lower edge of the top bar while the router is loading the next
 * page. The old page stays on screen during that wait, and nothing else says the
 * click was heard.
 *
 * Decoration, so it is hidden from assistive technology. It moves with `transform`
 * only; under reduced motion it is a still bar.
 */
export function RouteProgress() {
  const isPending = useRouterState({ select: (s) => s.status === 'pending' })
  const [isShown, setIsShown] = useState(false)

  useEffect(() => {
    if (!isPending) return undefined
    const cancel = showAfterDelay(() => setIsShown(true), ROUTE_PROGRESS_DELAY_MS)
    return () => {
      cancel()
      setIsShown(false)
    }
  }, [isPending])

  if (!isPending || !isShown) return null

  return (
    <div
      aria-hidden="true"
      data-slot="route-progress"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
    >
      <div className="h-full w-1/3 animate-route-progress bg-primary motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60" />
    </div>
  )
}
