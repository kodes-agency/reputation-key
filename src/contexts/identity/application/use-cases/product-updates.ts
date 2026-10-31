import type { AuthContext } from '#/shared/domain/auth-context'
import type { Clock } from '#/shared/domain/clock'
import type { Capability } from '#/shared/governance/capability-fate'
import { PRODUCT_UPDATES } from '#/shared/whats-new/entries'
import { eligibleProductUpdates, productUpdatesView } from '../product-updates-policy'
import type { ProductUpdatesStore } from '../ports/product-updates.port'

type Scope = Readonly<{ actor: AuthContext; propertyId?: string }>
type Deps = Readonly<{
  store: ProductUpdatesStore
  clock: Clock
  hasCapability: (scope: Scope, capability: Capability) => boolean
}>

export function createProductUpdates({ store, clock, hasCapability }: Deps) {
  const get = async (scope: Scope) =>
    productUpdatesView(
      eligibleProductUpdates(
        PRODUCT_UPDATES,
        scope.actor.role,
        (capability) => hasCapability(scope, capability),
        clock(),
      ),
      await store.read(scope.actor),
      clock(),
    )
  return Object.freeze({
    get,
    claim: async (scope: Scope) =>
      (await get(scope)).shouldAutoOpen && store.claim(scope.actor),
    markSeen: async (scope: Scope, entryIds: readonly string[]) => {
      const allowed = new Set((await get(scope)).entries.map(({ id }) => id))
      await store.markSeen(
        scope.actor,
        [...new Set(entryIds)].filter((id) => allowed.has(id)),
      )
    },
    setAutoShow: (actor: AuthContext, autoShow: boolean) =>
      store.setAutoShow(actor, autoShow),
  })
}
