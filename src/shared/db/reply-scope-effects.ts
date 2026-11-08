import type { SQL } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'

/**
 * The Reply effects that shared database code needs inside a caller's
 * transaction. The Reply writer implements them; shared code may not import a
 * context, so every entry point that can reach purge or restore fencing is
 * handed the implementation where it is built.
 */
export type ReplyScopeEffects = Readonly<{
  withdrawAiDrafts(tx: Tx, scope: SQL): Promise<void>
  fenceReplyPublicationsAfterRestore(
    tx: Tx,
  ): Promise<Readonly<{ cancelled: number; ambiguous: number }>>
  cancelRepliesForOrganizationClosing(
    tx: Tx,
    request: OrganizationReplyRequest,
  ): Promise<number>
  scrubOrganizationReplyContent(
    tx: Tx,
    request: OrganizationReplyRequest,
  ): Promise<number>
  releaseOrganizationAttemptConfirmations(
    tx: Tx,
    request: OrganizationReplyRequest,
  ): Promise<number>
  deleteOrganizationPublicationAttempts(tx: Tx, organizationId: string): Promise<number>
}>

type OrganizationReplyRequest = Readonly<{ organizationId: string; occurredAt: Date }>

/**
 * Fails closed: an entry point built without the effects stops at the first
 * purge or fence instead of leaving Replies untouched.
 */
export function requireReplyScopeEffects(
  effects: ReplyScopeEffects | undefined,
): ReplyScopeEffects {
  if (!effects) throw new Error('Reply scope effects are not provided')
  return effects
}
