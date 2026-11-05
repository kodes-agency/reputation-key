import { describe, expect, it } from 'vitest'
import type { PortalPublicationSnapshot } from '../../domain/portal-publication-snapshot'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import {
  GOLDEN_AT,
  GOLDEN_SNAPSHOT_ROWS,
} from '../__fixtures__/publication-snapshots.golden'
import { resolvePublicPortalToken } from './resolve-public-portal-token'

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
      digest: () => ({
        kind: 'long',
        tokenIdentifier: 'key',
        tokenHash: 'hash',
        tokenKeyVersion: 1,
      }),
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

describe('retired publication formats', () => {
  it.each(Object.keys(GOLDEN_SNAPSHOT_ROWS) as (keyof typeof GOLDEN_SNAPSHOT_ROWS)[])(
    'does not serve the retained %s evidence as a public page',
    async (key) => {
      expect(await resolveGolden(key)).toEqual({ status: 'unavailable' })
    },
  )
})
