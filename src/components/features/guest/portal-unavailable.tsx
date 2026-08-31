import { Globe } from 'lucide-react'

/**
 * The single public posture for a Portal a guest cannot reach — a bad or
 * rotated token, an unpublished Portal, a suspended Property, or a denied
 * capability all land here so none of them is distinguishable from outside
 * (routes/p/$token.tsx).
 *
 * `main` is load-bearing, not decoration: without a landmark every word on
 * this page sits outside one, which is exactly what a screen-reader user
 * navigating by landmark finds nothing of.
 */
export function PortalUnavailable() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="flex flex-col items-center space-y-4 text-center">
        <Globe aria-hidden="true" className="size-16 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Portal Unavailable</h1>
        <p className="text-sm text-muted-foreground">Please try again later.</p>
      </div>
    </main>
  )
}
