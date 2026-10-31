import type { Role } from '#/shared/domain/roles'
import type { Capability } from '#/shared/governance/capability-fate'
import type { ProductUpdate, ProductUpdatesView } from '#/shared/whats-new/types'

const DAY = 86_400_000
export const AUTO_OPEN_INTERVAL_MS = 7 * DAY

export type ProductUpdateState = Readonly<{
  membershipStartedAt: Date
  autoShow: boolean
  lastAutoOpenedAt: Date | null
  seenIds: readonly string[]
}>

export function eligibleProductUpdates(
  entries: readonly ProductUpdate[],
  role: Role,
  hasCapability: (capability: Capability) => boolean,
  now: Date,
): readonly ProductUpdate[] {
  return entries.filter(
    (entry) =>
      new Date(entry.publishedOn).getTime() <= now.getTime() &&
      (entry.audience === 'everyone' || role === 'AccountAdmin') &&
      (!entry.requires?.capability || hasCapability(entry.requires.capability)),
  )
}

export function productUpdatesView(
  entries: readonly ProductUpdate[],
  state: ProductUpdateState,
  now: Date,
): ProductUpdatesView {
  const seen = new Set(state.seenIds)
  const unseen = entries.filter(
    (entry) =>
      new Date(entry.publishedOn).getTime() >= state.membershipStartedAt.getTime() &&
      !seen.has(entry.id),
  )
  const recentHighlight = unseen.some(
    (entry) =>
      entry.kind === 'highlight' &&
      new Date(entry.publishedOn).getTime() >= now.getTime() - 60 * DAY,
  )
  const cooledDown =
    state.lastAutoOpenedAt === null ||
    state.lastAutoOpenedAt.getTime() < now.getTime() - AUTO_OPEN_INTERVAL_MS
  return {
    entries,
    unseenIds: unseen.map(({ id }) => id),
    autoShow: state.autoShow,
    shouldAutoOpen: state.autoShow && recentHighlight && cooledDown,
  }
}
