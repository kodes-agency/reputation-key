import { describe, expect, it } from 'vitest'
import {
  recoverPropertyImportInputSchema,
  retryPropertyImportItemInputSchema,
  startPropertyImportInputSchema,
  getPropertyImportStatusInputSchema,
} from './google-import-v2.dto'

const CANDIDATE_A = `v1.${'A'.repeat(43)}`
const CANDIDATE_B = `v1.${'B'.repeat(43)}`

function createRequest() {
  return {
    requestId: '00000000-0000-4000-8000-000000000001',
    confirmation: 'apply' as const,
    items: [
      {
        candidateRef: CANDIDATE_A,
        action: 'create' as const,
        profile: {
          name: '  Café   North  ',
          address: null,
          countryCode: 'us',
          timezone: 'America/New_York',
          confirmed: true as const,
        },
      },
    ],
  }
}

describe('Google import v2 DTOs', () => {
  it('normalizes a confirmed create profile and preserves an explicit null address', () => {
    const result = startPropertyImportInputSchema.parse(createRequest())

    expect(result.items[0]).toEqual({
      candidateRef: CANDIDATE_A,
      action: 'create',
      profile: {
        name: 'Café North',
        address: null,
        countryCode: 'US',
        timezone: 'America/New_York',
        confirmed: true,
      },
    })
  })

  it('accepts both exact relink profile variants and strips no ignored fields', () => {
    const preserved = startPropertyImportInputSchema.safeParse({
      ...createRequest(),
      items: [
        {
          candidateRef: CANDIDATE_A,
          action: 'relink',
          existingPropertyId: '00000000-0000-4000-8000-000000000002',
          profile: {
            timezone: 'Europe/Sofia',
            confirmed: true,
            updateExistingProfile: false,
          },
        },
      ],
    })
    const updated = startPropertyImportInputSchema.safeParse({
      ...createRequest(),
      items: [
        {
          candidateRef: CANDIDATE_A,
          action: 'relink',
          existingPropertyId: '00000000-0000-4000-8000-000000000002',
          profile: {
            name: 'Updated',
            address: '  1   Main St  ',
            timezone: 'Europe/Sofia',
            confirmed: true,
            updateExistingProfile: true,
          },
        },
      ],
    })

    expect(preserved.success).toBe(true)
    expect(updated.success).toBe(true)
    if (updated.success)
      expect(updated.data.items[0]!.profile).toMatchObject({ address: '1 Main St' })
  })

  it.each([
    ['non-UUID request', { ...createRequest(), requestId: 'request-1' }],
    [
      'unconfirmed profile',
      {
        ...createRequest(),
        items: [
          {
            ...createRequest().items[0],
            profile: { ...createRequest().items[0]!.profile, confirmed: false },
          },
        ],
      },
    ],
    [
      'unknown country',
      {
        ...createRequest(),
        items: [
          {
            ...createRequest().items[0],
            profile: { ...createRequest().items[0]!.profile, countryCode: 'ZZ' },
          },
        ],
      },
    ],
    [
      'unknown timezone',
      {
        ...createRequest(),
        items: [
          {
            ...createRequest().items[0],
            profile: { ...createRequest().items[0]!.profile, timezone: 'Mars/Olympus' },
          },
        ],
      },
    ],
    [
      'duplicate reference',
      {
        ...createRequest(),
        items: [createRequest().items[0], createRequest().items[0]],
      },
    ],
    [
      'action/profile mismatch',
      {
        ...createRequest(),
        items: [{ ...createRequest().items[0], action: 'relink' }],
      },
    ],
    ['unknown field', { ...createRequest(), providerLocationId: 'forbidden' }],
  ])('rejects %s', (_name, input) => {
    expect(startPropertyImportInputSchema.safeParse(input).success).toBe(false)
  })

  it('accepts 100 unique items and rejects 101', () => {
    const items = Array.from({ length: 101 }, (_, index) => ({
      ...createRequest().items[0],
      candidateRef: `v1.${index.toString(36).padStart(43, '0')}`,
    }))
    expect(
      startPropertyImportInputSchema.safeParse({
        ...createRequest(),
        items: items.slice(0, 100),
      }).success,
    ).toBe(true)
    expect(
      startPropertyImportInputSchema.safeParse({ ...createRequest(), items }).success,
    ).toBe(false)
  })

  it('pins recovery, status, and retry identifiers', () => {
    const requestId = '00000000-0000-4000-8000-000000000001'
    const importJobId = '00000000-0000-4000-8000-000000000002'
    const itemId = '00000000-0000-4000-8000-000000000003'
    const retryRequestId = '00000000-0000-4000-8000-000000000004'

    expect(recoverPropertyImportInputSchema.parse({ requestId })).toEqual({ requestId })
    expect(getPropertyImportStatusInputSchema.parse({ importJobId })).toEqual({
      importJobId,
    })
    expect(
      retryPropertyImportItemInputSchema.parse({
        itemId,
        retryRequestId,
        expectedRetryRevision: 2,
      }),
    ).toEqual({ itemId, retryRequestId, expectedRetryRevision: 2 })
    expect(
      retryPropertyImportItemInputSchema.safeParse({
        itemId,
        retryRequestId,
        expectedRetryRevision: -1,
      }).success,
    ).toBe(false)
  })

  it('does not accept a second candidate handle under another item', () => {
    const request = createRequest()
    expect(
      startPropertyImportInputSchema.safeParse({
        ...request,
        items: [request.items[0], { ...request.items[0], candidateRef: CANDIDATE_B }],
      }).success,
    ).toBe(true)
  })
})
