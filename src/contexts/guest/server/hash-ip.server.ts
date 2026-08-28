// IP hashing — server-only (uses Node crypto + the guest-session salt).
//
// Named `*.server.ts` so TanStack Start's import protection (enabled by
// default) mocks this module in the client bundle instead of letting
// `node:crypto` execute in the browser and crash hydration.
// Runtime secrets are supplied once by the Guest composition root.

import { createHmac } from 'crypto'
import type { GuestNetworkPressureAction } from '../domain/networkPressure'

export type GuestNetworkPseudonymInput = Readonly<{
  secret: string
  ip: string
  organizationId: string
  portalId: string
  action: GuestNetworkPressureAction
  observedAt: Date
}>

export function deriveGuestNetworkPseudonym(input: GuestNetworkPseudonymInput): string {
  if (!input.secret) throw new Error('Guest network pseudonym secret is required')
  if (!input.organizationId.trim() || !input.portalId.trim()) {
    throw new Error('Guest network pseudonym scope is required')
  }
  if (!Number.isFinite(input.observedAt.getTime())) {
    throw new Error('Guest network pseudonym time is invalid')
  }
  const day = input.observedAt.toISOString().slice(0, 10)
  return createHmac('sha256', input.secret)
    .update(
      `v2:${day}:${input.organizationId}:${input.portalId}:${input.action}:${input.ip}`,
    )
    .digest('hex')
}

export type GuestNetworkPseudonymHasher = (
  ip: string,
  scope: Readonly<{ organizationId: string; portalId: string }>,
  action: GuestNetworkPressureAction,
  observedAt: Date,
) => string

/**
 * Bind the secret at composition time so public request handlers never read
 * environment state and every derivation must supply its observed instant.
 */
export const createGuestNetworkPseudonymHasher = (
  secret: string,
): GuestNetworkPseudonymHasher => {
  if (!secret) throw new Error('Guest network pseudonym secret is required')
  return (ip, scope, action, observedAt) =>
    deriveGuestNetworkPseudonym({ secret, ip, ...scope, action, observedAt })
}
