// The photograph and logo dialogs, fetched when one is first opened. They carry
// the file checks, the focal picker and the permission text, which only a person
// changing an image needs, so neither the Property look page nor a portal's Look
// section ships them with the page. A dialog is mounted from its first opening on
// (closed again it keeps its exit animation), and its body is still mounted only
// while open, as the dialogs themselves do.
import { lazy, Suspense, useState, type ComponentProps } from 'react'
import type { PropertyLookLogoDialog as LogoDialogComponent } from './property-look-logo-dialog'
import type { PropertyLookPhotoDialog as PhotoDialogComponent } from './property-look-photo-dialog'

const PhotoDialog = lazy(() =>
  import('./property-look-photo-dialog').then((module) => ({
    default: module.PropertyLookPhotoDialog,
  })),
)
const LogoDialog = lazy(() =>
  import('./property-look-logo-dialog').then((module) => ({
    default: module.PropertyLookLogoDialog,
  })),
)

/** True from the first time `open` is true on: nothing is fetched for a dialog nobody opens. */
function useOpenedOnce(open: boolean): boolean {
  const [hasOpened, setHasOpened] = useState(false)
  if (open && !hasOpened) setHasOpened(true)
  return open || hasOpened
}

export function LazyPropertyLookPhotoDialog(
  props: ComponentProps<typeof PhotoDialogComponent>,
) {
  const isMounted = useOpenedOnce(props.open)
  if (!isMounted) return null
  return (
    <Suspense fallback={null}>
      <PhotoDialog {...props} />
    </Suspense>
  )
}

export function LazyPropertyLookLogoDialog(
  props: ComponentProps<typeof LogoDialogComponent>,
) {
  const isMounted = useOpenedOnce(props.open)
  if (!isMounted) return null
  return (
    <Suspense fallback={null}>
      <LogoDialog {...props} />
    </Suspense>
  )
}
