// Loads the bell popover's lazy body, and says so when it cannot.
//
// The body is a separate chunk (notification-panel.tsx). A tab left open
// across a deploy asks for a chunk name the new build no longer serves, and a
// network failure looks the same: the import rejects. Suspense does not catch
// a rejection, so it used to escape to the route's error boundary and replace
// the whole app shell, from a bell that is on every page. A failed load now
// resolves to a body that says what happened, inside the popover. The way
// back is a reload: React.lazy keeps what the import resolved to, and the old
// chunk name would miss again, so only a fresh page gets the new build.

import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '#/components/ui/button'

const reloadPage = () => window.location.reload()

/** What the popover shows when its body could not be loaded. */
export function PopoverBodyUnavailable({
  onReload = reloadPage,
}: Readonly<{ onReload?: () => void }>) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-6 text-center">
      <p className="text-sm text-muted-foreground">Couldn&apos;t load notifications.</p>
      <Button variant="outline" size="sm" onClick={onReload}>
        <RefreshCw aria-hidden="true" className="size-3" />
        Reload page
      </Button>
    </div>
  )
}

/** A lazy popover body whose failed load renders PopoverBodyUnavailable. */
export function lazyPopoverBody<Props extends object>(
  load: () => Promise<ComponentType<Props>>,
): LazyExoticComponent<ComponentType<Props>> {
  const Unavailable: ComponentType<Props> = () => <PopoverBodyUnavailable />
  return lazy(() =>
    load().then(
      (Body) => ({ default: Body }),
      () => ({ default: Unavailable }),
    ),
  )
}
