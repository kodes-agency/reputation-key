// The one grant write every PropertyAccessGrant command uses: the operator
// grant and the Members access edit. Called with the per-grant advisory lock
// held and the Property checked live, it locks the unrevoked row, asks the
// domain rule what to do with it, and retires a superseded row before the
// insert so the one-active-grant index holds.

import type { Tx } from '#/shared/outbox/commit'
import { decidePropertyGrant } from '../domain/property-access-grant'
import { lockUnrevokedGrant } from './property-grant-locks'
import {
  grantPropertyAccess,
  revokePropertyAccess,
} from './repositories/property-access-grant.repository'

/** Why a grant this command replaced was retired. */
const SUPERSEDED_REASON = 'superseded'

export type PropertyGrantWrite = Readonly<{
  organizationId: string
  propertyId: string
  userId: string
  createdBy?: string
  /** When the grant lapses; `null` grants without an expiry. */
  expiresAt: Date | null
  /** Whether an active grant with another expiry is replaced or kept. */
  replacesActiveTerm: boolean
  now: Date
}>

/**
 * Grant one Property. Answers whether the grant table changed: a grant that
 * already gives what was asked is kept, and a kept grant records no fact.
 */
export async function writePropertyGrant(
  tx: Tx,
  write: PropertyGrantWrite,
): Promise<boolean> {
  const key = {
    organizationId: write.organizationId,
    propertyId: write.propertyId,
    userId: write.userId,
  }
  const decision = decidePropertyGrant({
    current: await lockUnrevokedGrant(tx, key),
    expiresAt: write.expiresAt,
    replacesActiveTerm: write.replacesActiveTerm,
    now: write.now,
  })
  if (decision === 'keep') return false
  // The grant it replaces still holds the one-active-grant slot: retire it first.
  if (decision === 'supersede') {
    await revokePropertyAccess(tx, { ...key, reason: SUPERSEDED_REASON })
  }
  await grantPropertyAccess(tx, {
    ...key,
    // A grant from a person is an operator grant, whichever surface made it.
    source: 'operator',
    createdBy: write.createdBy,
    expiresAt: write.expiresAt ?? undefined,
  })
  return true
}
