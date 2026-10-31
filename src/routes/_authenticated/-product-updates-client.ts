import type { ProductUpdatesClientGetter } from '#/shared/whats-new/types'
export const getProductUpdatesClient: ProductUpdatesClientGetter = async () =>
  (await import('./-product-updates-fns')).productUpdatesFns
