import { expect } from 'vitest'
import type { Portal } from '#/contexts/portal/domain/types'
import type { PortalPublicationSnapshot } from '#/contexts/portal/domain/portal-publication-snapshot'
import { resolvePublicPortalToken } from '#/contexts/portal/application/use-cases/resolve-public-portal-token'
import { toPublicPortalLoaderData } from '#/contexts/guest/application/dto/public-portal.dto'
import { loadPortalPrintKitContext } from '#/contexts/portal/application/load-portal-print-kit-context'
import { printKitFileName } from '#/shared/domain/portal-print-kit'
import {
  printFinalFileName,
  printFinalDocumentTitle,
} from '#/shared/domain/portal-print-final-how-to'

/** Runs the actual guest and print projections on a personal Portal's first snapshot. */
export async function assertPersonalPortalNameSeparation(
  portal: Portal,
  snapshot: PortalPublicationSnapshot,
) {
  const config = snapshot.configuration
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
      resolveActiveByTokenDigest: async () => ({
        snapshot,
        token: {
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
          portalId: portal.id,
          version: 1,
        },
      }),
    },
    portalHealthRepo: {
      getCurrent: async () => ({
        id: 'health',
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        portalId: portal.id,
        status: 'healthy',
        reason: 'operational',
        sourceVersion: '1',
        effectiveFrom: snapshot.createdAt,
        effectiveTo: null,
        observedAt: snapshot.createdAt,
      }),
    },
    listApprovedSecondaryDestinationUris: async (_org, _property, uris) => uris,
    isPropertyActive: async () => true,
    getGoogleReviewDestination: async () => ({
      state: 'verified',
      uri: config.reviewGateway.googleReview.uri,
      retrievedAt: new Date(config.googleReviewBinding.retrievedAt),
      sourceEpoch: config.googleReviewBinding.sourceEpoch,
      profileVersion: config.googleReviewBinding.profileVersion,
    }),
    decidePublic: async () => ({ allowed: true }),
    clock: () => snapshot.createdAt,
  })
  const resolved = await resolve('pt_key_secret')
  expect(resolved.status).toBe('found')
  if (resolved.status !== 'found') throw new Error('The personal Portal must resolve')
  const loader = toPublicPortalLoaderData(resolved.data, {
    servedAt: snapshot.createdAt.toISOString(),
    guestSession: { csrfNonce: 'nonce' },
    response: null,
    responseForm: { availability: 'available' },
  })
  const print = await loadPortalPrintKitContext(
    {
      publicationRepo: {
        findActiveForPortal: async () => snapshot,
        loadWorkingCopy: async () => null,
      },
    },
    { organizationId: portal.organizationId, portal },
  )
  const metadata = {
    kitTitle: `${print.portalName} counter card`,
    kitFile: printKitFileName(print.portalName, 'counter_card', ['en'], {
      style: 'paper',
      paper: 'letter',
    }),
    finalTitle: printFinalDocumentTitle(print.portalName, 'counter'),
    finalFile: printFinalFileName(print.portalName, {
      piece: 'counter',
      orientation: 'upright',
      look: 'paper',
      paper: 'letter',
      printer: 'my_printer',
      languages: ['en'],
    }),
  }
  expect(portal.name).toBe('Polly Smith')
  expect(portal.slug).toMatch(/^portal-[a-f0-9]+$/)
  for (const output of [snapshot, loader, resolved.data.portal.slug, metadata])
    expect(JSON.stringify(output)).not.toMatch(/polly|smith/i)
}
