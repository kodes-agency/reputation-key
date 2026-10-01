// Portal command store — the guest language set of a Portal: the guard on the
// locale-set fact and the re-mirroring of link texts when the primary language
// changes. Split out of portal-command-store.ts.

import { portals } from '#/shared/db/schema'
import { parseGuestLocale } from '#/shared/domain/guest-locale'
import { unbrand } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import type { UpdatePortalCommand } from '../application/ports/portal-command-store.port'
import { portalError } from '../domain/errors'
import { sameInstant } from './portal-command-guards'
import { portalScopeWhere, reconcileLinkTextsToPrimary } from './portal-link-texts-store'

/** An emitted locale-set fact must restate exactly the locales this patch writes. */
export function assertLocaleSetFact(command: UpdatePortalCommand): void {
  const fact = command.localeSetEvent
  if (!fact) return
  if (
    fact.organizationId !== command.organizationId ||
    fact.propertyId !== command.propertyId ||
    fact.portalId !== command.portalId ||
    fact.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(fact.occurredAt, command.occurredAt) ||
    fact.primaryGuestLocale !== command.patch.primaryGuestLocale ||
    JSON.stringify(fact.additionalGuestLocales) !==
      JSON.stringify(command.patch.additionalGuestLocales)
  ) {
    throw portalError('forbidden', 'Portal locale-set fact does not match its update')
  }
}

/**
 * Call inside the update transaction, before the Portal row is written (the old
 * primary is only visible then). The returned function, called after the write,
 * re-mirrors each link's label and primary-language text when the primary
 * language actually changed, and does nothing otherwise.
 */
export async function watchPrimaryLocaleChange(
  tx: Tx,
  command: UpdatePortalCommand,
): Promise<() => Promise<void>> {
  const next = command.patch.primaryGuestLocale
  if (!next) return async () => {}
  const scope = {
    organizationId: unbrand(command.organizationId),
    propertyId: unbrand(command.propertyId),
    portalId: unbrand(command.portalId),
  }
  const [before] = await tx
    .select({ primary: portals.primaryGuestLocale })
    .from(portals)
    .where(portalScopeWhere(scope))
    .limit(1)
  if (!before) return async () => {}
  const previous = parseGuestLocale(before.primary)
  if (!previous) throw new Error('Portal has a guest locale outside the catalogue')
  if (previous === next) return async () => {}
  return () =>
    reconcileLinkTextsToPrimary(
      tx,
      scope,
      { actorUserId: unbrand(command.actorUserId), at: command.occurredAt },
      next,
      previous,
    )
}
