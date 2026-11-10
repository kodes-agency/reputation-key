// Activity's Organization erasure: Recent Activity, its reconstruction
// authority and its actor-label privacy fence. Operational Action History is
// independently required evidence and stays: its append-only guards reject
// DELETE. The rights executor runs this behind its journal entry.

import { eq } from 'drizzle-orm'
import {
  recentActivityActorLabelRedactions,
  recentActivityEntries,
  recentActivityReplayFacts,
} from '#/shared/db/schema/activity.schema'
import type { Tx } from '#/shared/outbox/commit'

export type ActivityLifecycleProjectionCounts = Readonly<{
  entries: number
  replayFacts: number
  actorLabelRedactions: number
}>

export const eraseActivityOrganizationRows = async (
  tx: Tx,
  organization: string,
): Promise<ActivityLifecycleProjectionCounts> => {
  const entries = await tx
    .delete(recentActivityEntries)
    .where(eq(recentActivityEntries.organizationId, organization))
    .returning({ id: recentActivityEntries.id })

  const replayFacts = await tx
    .delete(recentActivityReplayFacts)
    .where(eq(recentActivityReplayFacts.organizationId, organization))
    .returning({ replayKey: recentActivityReplayFacts.replayKey })

  const actorLabelRedactions = await tx
    .delete(recentActivityActorLabelRedactions)
    .where(eq(recentActivityActorLabelRedactions.organizationId, organization))
    .returning({ actorSubjectId: recentActivityActorLabelRedactions.actorSubjectId })

  return {
    entries: entries.length,
    replayFacts: replayFacts.length,
    actorLabelRedactions: actorLabelRedactions.length,
  }
}
