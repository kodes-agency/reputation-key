import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import type { ImportCandidateDto } from '#/contexts/integration/application/public-api'
import {
  applyBulkTimezone,
  buildConfirmedImportItems,
  createImportReviewDraft,
} from './google-import-review-model'

const createCandidate: ImportCandidateDto = {
  candidateId: 'candidate-create',
  candidateRef: 'candidate.create',
  accountRef: 'account.ref',
  accountDisplayName: 'Primary account',
  businessName: '  Café\u00a0North  ',
  address: '  10   Main St  ',
  primaryCategory: 'Cafe',
  countryCode: 'us',
  eligibility: { kind: 'create' },
}

const relinkCandidate: ImportCandidateDto = {
  candidateId: 'candidate-relink',
  candidateRef: 'candidate.relink',
  accountRef: 'account.ref',
  accountDisplayName: 'Primary account',
  businessName: 'Provider name',
  address: 'Provider address',
  primaryCategory: 'Hotel',
  countryCode: 'GB',
  eligibility: {
    kind: 'relink',
    propertyId: '10000000-0000-4000-8000-000000000002' as never,
    profile: {
      name: 'Confirmed hotel',
      address: '2 High Street',
      countryCode: 'GB',
      timezone: 'Europe/London',
      profileVersion: 4,
    },
  },
}

describe('Google import review model', () => {
  it('suggests browser timezone for creates and existing timezone for relinks', () => {
    const draft = createImportReviewDraft(
      [createCandidate, relinkCandidate],
      'America/New_York',
    )

    expect(draft.items[0]).toMatchObject({
      name: 'Café North',
      address: '10 Main St',
      countryCode: 'US',
      timezone: 'America/New_York',
      countryConfirmed: false,
      timezoneConfirmed: false,
    })
    expect(draft.items[1]).toMatchObject({
      name: 'Confirmed hotel',
      timezone: 'Europe/London',
      updateExistingProfile: false,
      timezoneConfirmed: false,
    })
  })

  it('refuses to build a command from an incomplete review', () => {
    const draft = createImportReviewDraft([createCandidate, relinkCandidate], 'UTC')
    draft.items[0] = { ...draft.items[0]!, countryCode: '', name: '' }

    expect(() => buildConfirmedImportItems(draft)).toThrow(ZodError)
  })

  it('applies a bulk timezone without erasing a later per-row override', () => {
    const draft = createImportReviewDraft([createCandidate, relinkCandidate], 'UTC')
    const bulk = applyBulkTimezone(draft, 'Europe/Paris')
    bulk.items[1] = {
      ...bulk.items[1]!,
      timezone: 'Europe/London',
      timezoneConfirmed: true,
    }

    expect(bulk.items.map((item) => item.timezone)).toEqual([
      'Europe/Paris',
      'Europe/London',
    ])
  })

  it('builds normalized immutable create and preserve-profile relink inputs', () => {
    const draft = createImportReviewDraft(
      [createCandidate, relinkCandidate],
      'America/New_York',
    )
    draft.items[0] = {
      ...draft.items[0]!,
      countryConfirmed: true,
      timezoneConfirmed: true,
    }
    draft.items[1] = { ...draft.items[1]!, timezoneConfirmed: true }

    const items = buildConfirmedImportItems(draft)
    expect(items).toEqual([
      {
        candidateRef: 'candidate.create',
        action: 'create',
        profile: {
          name: 'Café North',
          address: '10 Main St',
          countryCode: 'US',
          timezone: 'America/New_York',
          confirmed: true,
        },
      },
      {
        candidateRef: 'candidate.relink',
        action: 'relink',
        existingPropertyId: '10000000-0000-4000-8000-000000000002',
        profile: {
          timezone: 'Europe/London',
          confirmed: true,
          updateExistingProfile: false,
        },
      },
    ])
    expect(Object.isFrozen(items)).toBe(true)
    expect(Object.isFrozen(items[0])).toBe(true)
  })
})
