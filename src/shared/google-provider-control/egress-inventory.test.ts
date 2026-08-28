import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GOOGLE_PROVIDER_ROUTE_KEYS } from './contracts'
import {
  GOOGLE_PROVIDER_EGRESS_INVENTORY,
  assertGoogleProviderEgressInventory,
} from './egress-inventory'

describe('Google provider egress inventory', () => {
  it('accounts for every frozen route exactly once', () => {
    expect(Object.keys(GOOGLE_PROVIDER_EGRESS_INVENTORY).sort()).toEqual(
      [...GOOGLE_PROVIDER_ROUTE_KEYS].sort(),
    )
    expect(() => assertGoogleProviderEgressInventory()).not.toThrow()
  })

  it('keeps the sole direct exception non-credential, fixed-origin, and repeat-safe', () => {
    const direct = Object.entries(GOOGLE_PROVIDER_EGRESS_INVENTORY).filter(
      ([, entry]) => entry.transport === 'direct_fixed_trust_read',
    )

    expect(direct).toEqual([
      [
        'oauth.jwks',
        expect.objectContaining({
          method: 'GET',
          credential: 'none',
          recovery: 'safe_read_repeat',
          repositoryState: 'direct_fixed_trust_read',
        }),
      ],
    ])
  })

  it('never classifies a provider write or one-time credential operation as repeat-safe', () => {
    for (const [routeKey, entry] of Object.entries(GOOGLE_PROVIDER_EGRESS_INVENTORY)) {
      if (entry.method !== 'GET' || routeKey === 'oauth.token.exchange') {
        expect(entry.recovery, routeKey).not.toBe('safe_read_repeat')
      }
    }
    expect(GOOGLE_PROVIDER_EGRESS_INVENTORY['oauth.token.exchange'].recovery).toBe(
      'preserve_then_never_reexchange',
    )
    expect(GOOGLE_PROVIDER_EGRESS_INVENTORY['oauth.revoke'].recovery).toBe(
      'one_use_revoke_reconciliation',
    )
    expect(GOOGLE_PROVIDER_EGRESS_INVENTORY['notifications.subscribe'].recovery).toBe(
      'desired_state_readback',
    )
  })

  it('records the executable durable recovery authority for one-use OAuth operations', () => {
    expect(GOOGLE_PROVIDER_EGRESS_INVENTORY['oauth.token.exchange'].repositoryState).toBe(
      'gateway_wired_durable_recovery',
    )
    expect(GOOGLE_PROVIDER_EGRESS_INVENTORY['oauth.token.refresh'].repositoryState).toBe(
      'gateway_wired',
    )
    expect(GOOGLE_PROVIDER_EGRESS_INVENTORY['oauth.revoke'].repositoryState).toBe(
      'gateway_wired_durable_recovery',
    )
  })

  it('pins every route to a real owning implementation', () => {
    for (const [routeKey, entry] of Object.entries(GOOGLE_PROVIDER_EGRESS_INVENTORY)) {
      const source = readFileSync(resolve(process.cwd(), entry.ownerModule), 'utf8')
      if (routeKey === 'oauth.jwks') {
        expect(source).toContain('fetch(config.jwksUrl')
      } else {
        expect(source, routeKey).toContain(`routeKey: '${routeKey}'`)
      }
    }
  })
})
