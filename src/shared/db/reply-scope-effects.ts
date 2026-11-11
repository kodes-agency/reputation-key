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
  /** Removes the provider-mirror Replies of one Review; returns how many. */
  deleteGoogleSyncMirrors(
    tx: Tx,
    scope: Readonly<{ organizationId: string; reviewId: string }>,
  ): Promise<number>
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
  /** The same effects for the Replies to one Property's Reviews. */
  cancelRepliesForPropertyClosing(tx: Tx, request: PropertyReplyRequest): Promise<number>
  scrubPropertyReplyContent(tx: Tx, request: PropertyReplyRequest): Promise<number>
  releasePropertyAttemptConfirmations(
    tx: Tx,
    request: PropertyReplyRequest,
  ): Promise<number>
  deletePropertyPublicationAttempts(
    tx: Tx,
    request: Readonly<{ organizationId: string; propertyId: string }>,
  ): Promise<number>
}>

type OrganizationReplyRequest = Readonly<{ organizationId: string; occurredAt: Date }>
type PropertyReplyRequest = OrganizationReplyRequest & Readonly<{ propertyId: string }>

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
