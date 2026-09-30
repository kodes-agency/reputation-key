// The resolved-configuration digest is stored as guest-response evidence. It was
// computed on main before the v3 reader existed, from the golden v1 and v2 rows,
// and must never move: nothing here may be regenerated to make a test pass.

import { describe, expect, it } from 'vitest'
import type { PortalPublicationSnapshot } from '../../domain/portal-publication-snapshot'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import {
  GOLDEN_AT,
  GOLDEN_SNAPSHOT_ROWS,
} from '../__fixtures__/publication-snapshots.golden'
import { resolvePublicPortalToken } from './resolve-public-portal-token'

const PINNED_DIGESTS = {
  v1: '79b6eb54902c2fc263eff2bc4ef21b976ce8b8dc045aa42a696c624b0f5d6dba',
  v2Seeded: '0e7f66538dcc498a43e4b5bace1d2cb096ea5cb2a5f56f211432ac1f9e10ec5b',
  v2BgPrimary: '3a6d59bbb80538e01871425176ccedbe9e6c419eabf8211724d0ddb1529e6365',
} as const

async function resolveGolden(key: keyof typeof GOLDEN_SNAPSHOT_ROWS) {
  const row = GOLDEN_SNAPSHOT_ROWS[key]
  // A golden row is the stored JSON; the repository's zod parse types it, and
  // that parse does not change it (see the golden mapper test).
  const snapshot = row as unknown as PortalPublicationSnapshot
  const token = {
    organizationId: snapshot.organizationId,
    propertyId: snapshot.propertyId,
    portalId: snapshot.portalId,
    version: 1,
  }
  const resolve = resolvePublicPortalToken({
    tokenCodec: {
      digest: () => ({ tokenIdentifier: 'key', tokenHash: 'hash', tokenKeyVersion: 1 }),
    },
    portalPublicationRepo: {
      resolveActiveByTokenDigest: async () => ({ token, snapshot }),
    },
    portalHealthRepo: {
      getCurrent: async () => ({
        id: 'health-1',
        organizationId: organizationId(token.organizationId),
        propertyId: propertyId(token.propertyId),
        portalId: portalId(token.portalId),
        status: 'healthy' as const,
        reason: 'operational' as const,
        sourceVersion: '1',
        effectiveFrom: GOLDEN_AT,
        effectiveTo: null,
        observedAt: GOLDEN_AT,
      }),
    },
    listApprovedSecondaryDestinationUris: async (_org, _property, uris) => uris,
    isPropertyActive: async () => true,
    getGoogleReviewDestination: async () => ({
      state: 'verified' as const,
      uri: snapshot.destinationUri,
      retrievedAt: GOLDEN_AT,
      sourceEpoch: snapshot.destinationSourceEpoch,
      profileVersion: snapshot.destinationProfileVersion,
    }),
    decidePublic: async () => ({ allowed: true }),
    clock: () => GOLDEN_AT,
  })
  return resolve('pt_key_secret')
}

describe('resolved configuration digest of a legacy publication', () => {
  it.each(Object.keys(PINNED_DIGESTS) as (keyof typeof PINNED_DIGESTS)[])(
    'is unchanged for the golden %s row',
    async (key) => {
      const outcome = await resolveGolden(key)
      if (outcome.status !== 'found') throw new Error('the golden row must resolve')

      expect(outcome.data.responseConfiguration.configurationDigest).toBe(
        PINNED_DIGESTS[key],
      )
      expect(outcome.data.immersive).toBeNull()
    },
  )
})
