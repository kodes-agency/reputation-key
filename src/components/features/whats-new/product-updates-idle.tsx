import type { ProductUpdatesClientGetter } from '#/shared/whats-new/types'
import { lazy, Suspense, useEffect, useState } from 'react'

const Controller = lazy(() => import('./product-updates-controller'))

export default function ProductUpdatesIdle({
  userId,
  organizationId,
  getClient,
}: Readonly<{
  userId: string
  organizationId: string
  getClient: ProductUpdatesClientGetter
}>) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(() => setReady(true), { timeout: 3000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = setTimeout(() => setReady(true), 1000)
    return () => clearTimeout(id)
  }, [])
  return ready ? (
    <Suspense fallback={null}>
      <Controller userId={userId} organizationId={organizationId} getClient={getClient} />
    </Suspense>
  ) : null
}
