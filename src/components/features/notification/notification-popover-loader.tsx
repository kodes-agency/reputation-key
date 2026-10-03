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
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { NotificationSheetHeader } from './notification-sheet-header'

const reloadPage = () => window.location.reload()

/**
 * What the popover shows when its body could not be loaded. On a phone
 * (`onClose`, the sheet's) it keeps the sheet's title and Close: a
 * full-screen sheet has no outside to tap.
 */
export function PopoverBodyUnavailable({
  onReload = reloadPage,
  onClose,
}: Readonly<{ onReload?: () => void; onClose?: () => void }>) {
  return (
    <>
      {onClose && <NotificationSheetHeader onClose={onClose} />}
      <div className="px-3 py-3">
        {/* Reload, not Try again: React.lazy keeps what the import resolved to,
            so only a fresh page can fetch the new build's chunk. */}
        <EmptyState
          tone="error"
          size="compact"
          icon={AlertCircle}
          title="Notifications couldn’t be loaded."
          action={
            <Button variant="outline" size="sm" onClick={onReload}>
              <RefreshCw aria-hidden="true" className="size-3" />
              Reload page
            </Button>
          }
        />
      </div>
    </>
  )
}

/** A lazy popover body whose failed load renders PopoverBodyUnavailable. */
export function lazyPopoverBody<Props extends object>(
  load: () => Promise<ComponentType<Props>>,
): LazyExoticComponent<ComponentType<Props>> {
  // The body's own props: in the sheet they carry its Close.
  const Unavailable: ComponentType<Props> = (props) => (
    <PopoverBodyUnavailable
      onClose={(props as Readonly<{ onClose?: () => void }>).onClose}
    />
  )
  return lazy(() =>
    load().then(
      (Body) => ({ default: Body }),
      () => ({ default: Unavailable }),
    ),
  )
}
