import type { ProductUpdatesClientGetter } from '#/shared/whats-new/types'
import { lazy, Suspense } from 'react'
import { usePropertyId } from '#/components/hooks/use-property-id'
import { Link } from '@tanstack/react-router'
import { DropdownMenuItem } from '#/components/ui/dropdown-menu'

// One lazy chunk marks both the account button and the menu item.
const Dot = lazy(() => import('./product-updates-dot'))

export function WhatsNewMenuItem({
  getClient,
}: Readonly<{ getClient: ProductUpdatesClientGetter }>) {
  const propertyId = usePropertyId()
  return (
    <DropdownMenuItem asChild>
      <Link to="/whats-new" search={{ propertyId: propertyId ?? undefined }}>
        What&apos;s new
        <Suspense fallback={null}>
          <Dot getClient={getClient} />
        </Suspense>
      </Link>
    </DropdownMenuItem>
  )
}

/**
 * Goes inside the account button, which must be `relative` and name `hintId` in
 * `aria-describedby`. It draws nothing until the shared read finds an update
 * the person has not seen, so a closed menu still tells them.
 */
export function AccountButtonUpdatesDot({
  getClient,
  hintId,
}: Readonly<{ getClient: ProductUpdatesClientGetter; hintId: string }>) {
  return (
    <Suspense fallback={null}>
      <Dot getClient={getClient} placement="trigger" hintId={hintId} />
    </Suspense>
  )
}
