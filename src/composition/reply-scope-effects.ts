import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import type { ReplyScopeEffects } from '#/shared/db/reply-scope-effects'

/**
 * Purge, restore fencing and the organization lifecycle end Replies through
 * the Reputation writer. Every entry point that can reach them is handed this
 * where it is built: the Application Container, the context builds, and the
 * deploy and operator scripts that run without a container.
 */
export const reputationReplyScopeEffects: ReplyScopeEffects = replyScopeEffects
