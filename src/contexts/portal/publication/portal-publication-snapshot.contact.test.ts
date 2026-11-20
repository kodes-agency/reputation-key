import { describe, expect, it, vi } from 'vitest'
import type { ContactRequestNotice } from '#/shared/domain/contact-request-notice'
import { publicationSource } from '../domain/__fixtures__/publication-source'
import { immersiveSnapshot } from '../application/__fixtures__/immersive-snapshot'
import {
  buildPortalPublicationSnapshot,
  reviewedPublicationDigest,
  verifyPortalPublicationSnapshot,
} from './portal-publication-snapshot.server'
import { workingCopyMatchesSnapshot } from './portal-working-copy-match.server'

const NOTICE: ContactRequestNotice = {
  noticeId: 'privacy-notice',
  noticeVersion: '4.0',
  noticeDigest: 'b'.repeat(64),
  locales: ['en'],
}

const notices = vi.hoisted(() => ({ inForce: [] as ContactRequestNotice[] }))

vi.mock('#/shared/domain/contact-request-notice', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('#/shared/domain/contact-request-notice')>()
  return {
    ...actual,
    contactNoticeEvidenceFor: (
      locale: Parameters<typeof actual.contactNoticeEvidenceFor>[0],
    ) => actual.contactNoticeEvidenceFor(locale, notices.inForce),
  }
})

const old = immersiveSnapshot()
const destination = {
  state: 'verified' as const,
  uri: old.destinationUri,
  retrievedAt: old.destinationRetrievedAt,
  sourceEpoch: old.destinationSourceEpoch,
  profileVersion: old.destinationProfileVersion,
}

const publish = (contactRequests: boolean) => {
  const source = publicationSource({ contactRequests })
  return {
    source,
    snapshot: buildPortalPublicationSnapshot({
      ...old,
      source,
      portalId: source.portal.id,
      organizationId: source.organizationId,
      propertyId: source.propertyId,
      destination,
    }),
  }
}

describe('contact requests in a publication', () => {
  it('publishes them off, whatever the setting says, while no notice in force covers them', () => {
    notices.inForce = []
    const { snapshot } = publish(true)
    expect(snapshot.configuration.reviewGateway).not.toHaveProperty('contactRequest')
    expect(snapshot.configurationDigest).toBe(publish(false).snapshot.configurationDigest)
  })

  it('pins the notice evidence when the setting is on and a notice covers contact requests', () => {
    notices.inForce = [NOTICE]
    const { snapshot } = publish(true)
    expect(snapshot.configuration.reviewGateway).toHaveProperty('contactRequest', {
      noticeId: 'privacy-notice',
      noticeVersion: '4.0',
      noticeDigest: 'b'.repeat(64),
      noticeLocale: 'en',
    })
    expect(snapshot.configurationDigest).not.toBe(
      publish(false).snapshot.configurationDigest,
    )
    expect(verifyPortalPublicationSnapshot(snapshot)).toBe(true)
  })

  it('leaves a Portal with the setting off off, notice or not', () => {
    notices.inForce = [NOTICE]
    expect(publish(false).snapshot.configuration.reviewGateway).not.toHaveProperty(
      'contactRequest',
    )
  })

  it('changes the reviewed digest with the setting only once a notice covers it', () => {
    const digest = (contactRequests: boolean) =>
      reviewedPublicationDigest(publicationSource({ contactRequests }), destination)
    notices.inForce = []
    expect(digest(true)).toBe(digest(false))
    notices.inForce = [NOTICE]
    expect(digest(true)).not.toBe(digest(false))
  })

  it('sees a pending change when the setting moved under a notice, and none when no notice covers it', () => {
    notices.inForce = []
    const live = publish(false)
    expect(
      workingCopyMatchesSnapshot(
        publicationSource({ contactRequests: true }),
        live.snapshot,
      ),
    ).toBe(true)
    notices.inForce = [NOTICE]
    expect(
      workingCopyMatchesSnapshot(
        publicationSource({ contactRequests: true }),
        live.snapshot,
      ),
    ).toBe(false)
  })

  it('refuses a snapshot whose pinned notice is malformed', () => {
    notices.inForce = [{ ...NOTICE, noticeDigest: 'not-a-digest' }]
    expect(() => publish(true)).toThrow(/content is incomplete or out of range/)
  })
})
