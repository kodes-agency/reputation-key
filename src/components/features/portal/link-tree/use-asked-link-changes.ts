// What the person has asked for in the Linktree that the server has not finished
// with: moves, and icons. The tiles shown are the saved ones with those applied,
// so a press or a choice is on screen at once and a quick second one builds on
// the first, never on a stale list. Once the section's writes have all settled
// the cache holds the truth, saved or rolled back, and the asks are dropped.

import { useState } from 'react'
import type { PortalLinktreeLink } from '#/contexts/portal/application/public-api'
import type { PortalLinkIconKey } from '#/shared/domain/portal-link-icon'
import { applyIconChoices, type IconChoices } from './linktree-photo-rules'
import { applyLinkOrder, type LinkOrderPlan } from './linktree-rules'

export function useAskedLinkChanges(saved: ReadonlyArray<PortalLinktreeLink>) {
  // Moves asked for that the server has not finished with. Each one is planned
  // from the order the person saw, which already holds the moves before it.
  const [plans, setPlans] = useState<ReadonlyArray<LinkOrderPlan>>([])
  const [icons, setIcons] = useState<IconChoices>({})
  const links = applyIconChoices(plans.reduce(applyLinkOrder, saved), icons)
  return {
    links,
    askMove: (plan: LinkOrderPlan) => setPlans((earlier) => [...earlier, plan]),
    askIcon: (linkId: string, iconKey: PortalLinkIconKey) =>
      setIcons((earlier) => ({ ...earlier, [linkId]: iconKey })),
    settled: () => {
      setPlans([])
      setIcons({})
    },
  }
}
