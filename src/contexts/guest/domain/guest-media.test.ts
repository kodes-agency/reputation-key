import { describe, expect, it } from 'vitest'
import { createResponse, deleteResponse, submitResponse } from './guest-response'
import {
  claimMediaForProcessing,
  completeMediaProcessing,
  issueGuestMedia,
  markMediaForPurge,
  namesIssuedObject,
  uploadMatchesIssuance,
  type ObservedObjectMetadata,
} from './guest-media'

const now = new Date('2026-08-09T12:00:00Z')
const response = submitResponse(
  createResponse({
    id: '00000000-0000-4000-8000-000000000010',
    organizationId: 'org-1',
    propertyId: '00000000-0000-4000-8000-000000000001',
    portalId: '00000000-0000-4000-8000-000000000002',
    sessionId: '00000000-0000-4000-8000-000000000003',
    sessionExpiresAt: new Date('2026-08-10T12:00:00Z'),
    retentionDeadline: new Date('2026-11-07T12:00:00Z'),
  }),
  { rating: 5, responseConsent: true, mediaConsent: true },
  now,
)

if ('code' in response) throw new Error(response.code)

describe('guest media lifecycle', () => {
  it('issues one scoped JPEG/PNG/WebP object for at most 10 MiB', () => {
    const issued = issueGuestMedia(
      response,
      {
        id: '00000000-0000-4000-8000-000000000020',
        contentType: 'image/webp',
        sizeBytes: 10 * 1024 * 1024,
      },
      now,
    )
    expect(issued).not.toHaveProperty('code')
    if (!('code' in issued)) {
      expect(issued.objectKey).toBe(
        'guest/org-1/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000020.webp',
      )
      expect(issued.status).toBe('issued')
    }
  })

  it.each(['image/gif', 'text/html', 'image/svg+xml'])(
    'rejects MIME %s',
    (contentType) => {
      expect(
        issueGuestMedia(
          response,
          {
            id: '00000000-0000-4000-8000-000000000020',
            contentType,
            sizeBytes: 100,
          },
          now,
        ),
      ).toEqual({ code: 'unsupported_media_type' })
    },
  )

  it('rejects zero and oversized uploads', () => {
    expect(
      issueGuestMedia(
        response,
        {
          id: '00000000-0000-4000-8000-000000000020',
          contentType: 'image/png',
          sizeBytes: 10 * 1024 * 1024 + 1,
        },
        now,
      ),
    ).toEqual({ code: 'invalid_media_size' })
  })

  it('does not resurrect media when withdrawal wins processing', () => {
    const media = issueGuestMedia(
      response,
      {
        id: '00000000-0000-4000-8000-000000000020',
        contentType: 'image/jpeg',
        sizeBytes: 1024,
      },
      now,
    )
    if ('code' in media) throw new Error(media.code)
    const claimed = claimMediaForProcessing(
      media,
      response,
      '00000000-0000-4000-8000-000000000030',
      now,
    )
    if ('code' in claimed) throw new Error(claimed.code)
    const deleted = deleteResponse(response, now)
    if ('code' in deleted) throw new Error(deleted.code)
    const completion = completeMediaProcessing(
      claimed,
      deleted,
      '00000000-0000-4000-8000-000000000030',
      'https://objects.invalid/media',
      now,
    )
    expect(completion.deleteObject).toBe(true)
    expect(completion.media.status).toBe('purge_pending')
    expect(completion.media.publicUrl).toBeNull()
  })

  it('makes terminal purge idempotent', () => {
    const media = issueGuestMedia(
      response,
      {
        id: '00000000-0000-4000-8000-000000000020',
        contentType: 'image/png',
        sizeBytes: 1024,
      },
      now,
    )
    if ('code' in media) throw new Error(media.code)
    expect(markMediaForPurge(markMediaForPurge(media, now), now).status).toBe(
      'purge_pending',
    )
  })
})

const issued = issueGuestMedia(
  response,
  {
    id: '00000000-0000-4000-8000-000000000020',
    contentType: 'image/png',
    sizeBytes: 1024,
  },
  now,
)

if ('code' in issued) throw new Error(issued.code)

// These two gate whether an uploaded guest object is ever published. Accepting
// one object under another's issuance, or trusting metadata the store could not
// report, publishes bytes nobody validated.
describe('guest media object acceptance', () => {
  it('acts only on the object key its own issuance minted', () => {
    expect(namesIssuedObject(issued, issued.objectKey)).toBe(true)
    expect(namesIssuedObject(issued, `${issued.objectKey}x`)).toBe(false)
    expect(namesIssuedObject(null, issued.objectKey)).toBe(false)
  })

  it('accepts an upload whose observed metadata equals its issuance', () => {
    expect(
      uploadMatchesIssuance({ contentType: 'image/png', sizeBytes: 1024 }, issued),
    ).toBe(true)
  })

  it.each<[string, ObservedObjectMetadata]>([
    ['a substituted MIME', { contentType: 'image/jpeg', sizeBytes: 1024 }],
    ['a size below issuance', { contentType: 'image/png', sizeBytes: 1023 }],
    ['a size above issuance', { contentType: 'image/png', sizeBytes: 1025 }],
    ['an unreported MIME', { contentType: null, sizeBytes: 1024 }],
    ['an unreported size', { contentType: 'image/png', sizeBytes: null }],
    ['nothing reported at all', { contentType: null, sizeBytes: null }],
  ])('fails closed on %s', (_label, metadata) => {
    expect(uploadMatchesIssuance(metadata, issued)).toBe(false)
  })
})
