import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import type { ImportCandidateDto } from '#/contexts/integration/application/public-api'
import {
  applyBulkTimezone,
  buildConfirmedImportItems,
  countFlaggedReviewItems,
  createImportReviewDraft,
  reviewItemIssues,
  timezoneAfterCountryChange,
} from './google-import-review-model'

const createCandidate: ImportCandidateDto = {
  candidateId: 'candidate-create',
  candidateRef: 'candidate.create',
  accountRef: 'account.ref',
  accountDisplayName: 'Primary account',
  businessName: '  Café North  ',
  address: '  10   Main St  ',
  primaryCategory: 'Cafe',
  countryCode: 'gb',
  eligibility: { kind: 'create' },
}

const multiZoneCandidate: ImportCandidateDto = {
  ...createCandidate,
  candidateId: 'candidate-multi-zone',
  candidateRef: 'candidate.multi',
  businessName: 'Harbor Hotel',
  countryCode: 'US',
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
      timezone: 'Europe/Lisbon',
      profileVersion: 4,
    },
  },
}

describe('Google import review model', () => {
  it('derives the timezone from the country and never from the browser', () => {
    const draft = createImportReviewDraft([
      createCandidate,
      multiZoneCandidate,
      relinkCandidate,
    ])

    expect(draft.profileAcknowledged).toBe(false)
    expect(draft.items[0]).toEqual({
      candidateId: 'candidate-create',
      candidateRef: 'candidate.create',
      action: 'create',
      existingPropertyId: null,
      name: 'Café North',
      address: '10 Main St',
      countryCode: 'GB',
      timezone: 'Europe/London',
      updateExistingProfile: true,
    })
    // Several zones: no guess, the row stays empty until the manager picks.
    expect(draft.items[1]).toMatchObject({ countryCode: 'US', timezone: '' })
    // A relinked property keeps its own timezone, even outside its country's zones.
    expect(draft.items[2]).toMatchObject({
      action: 'relink',
      name: 'Confirmed hotel',
      timezone: 'Europe/Lisbon',
      updateExistingProfile: false,
    })
  })

  it('flags a row without a timezone or a valid country until it is fixed', () => {
    const draft = createImportReviewDraft([createCandidate, multiZoneCandidate])

    expect(reviewItemIssues(draft.items[0]!)).toEqual({})
    expect(reviewItemIssues(draft.items[1]!)).toEqual({ timezone: 'Choose a timezone.' })
    expect(
      reviewItemIssues({ ...draft.items[0]!, countryCode: 'XX', name: ' ' }),
    ).toEqual({
      name: 'Enter a property name.',
      countryCode: 'Select a valid country.',
    })
    expect(countFlaggedReviewItems(draft.items)).toBe(1)
    expect(
      countFlaggedReviewItems([
        draft.items[0]!,
        { ...draft.items[1]!, timezone: 'America/Chicago' },
      ]),
    ).toBe(0)
  })

  it('keeps a matching timezone when the country changes and otherwise re-derives it', () => {
    expect(timezoneAfterCountryChange('FR', 'America/Chicago')).toBe('Europe/Paris')
    expect(timezoneAfterCountryChange('US', 'America/Chicago')).toBe('America/Chicago')
    expect(timezoneAfterCountryChange('US', 'Europe/Paris')).toBe('')
    expect(timezoneAfterCountryChange('', 'Europe/Paris')).toBe('')
  })

  it('applies a bulk timezone to every row and asks for the acknowledgement again', () => {
    const draft = {
      ...createImportReviewDraft([createCandidate, multiZoneCandidate, relinkCandidate]),
      profileAcknowledged: true,
    }
    const bulk = applyBulkTimezone(draft, 'Europe/Paris')
    const overridden = {
      ...bulk,
      items: bulk.items.map((item, index) =>
        index === 1 ? { ...item, timezone: 'America/Denver' } : item,
      ),
    }

    expect(bulk.items.map((item) => item.timezone)).toEqual([
      'Europe/Paris',
      'Europe/Paris',
      'Europe/Paris',
    ])
    expect(bulk.profileAcknowledged).toBe(false)
    expect(overridden.items.map((item) => item.timezone)).toEqual([
      'Europe/Paris',
      'America/Denver',
      'Europe/Paris',
    ])
    expect(draft.items[1]!.timezone).toBe('')
  })

  it('refuses to build a command from an incomplete table', () => {
    const draft = createImportReviewDraft([createCandidate, multiZoneCandidate])

    expect(() =>
      buildConfirmedImportItems({ ...draft, profileAcknowledged: true }),
    ).toThrow(ZodError)
  })

  it('refuses to build a command the manager has not acknowledged', () => {
    const draft = createImportReviewDraft([createCandidate, relinkCandidate])

    expect(() => buildConfirmedImportItems(draft)).toThrow(ZodError)
  })

  it('carries the one acknowledgement onto every item as an immutable confirmation', () => {
    const draft = createImportReviewDraft([
      createCandidate,
      multiZoneCandidate,
      relinkCandidate,
    ])
    const acknowledged = {
      profileAcknowledged: true,
      items: draft.items.map((item, index) =>
        index === 1 ? { ...item, timezone: 'America/New_York' } : item,
      ),
    }

    const items = buildConfirmedImportItems(acknowledged)
    expect(items).toEqual([
      {
        candidateRef: 'candidate.create',
        action: 'create',
        profile: {
          name: 'Café North',
          address: '10 Main St',
          countryCode: 'GB',
          timezone: 'Europe/London',
          confirmed: true,
        },
      },
      {
        candidateRef: 'candidate.multi',
        action: 'create',
        profile: {
          name: 'Harbor Hotel',
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
          timezone: 'Europe/Lisbon',
          confirmed: true,
          updateExistingProfile: false,
        },
      },
    ])
    expect(Object.isFrozen(items)).toBe(true)
    expect(Object.isFrozen(items[0])).toBe(true)
    expect(Object.isFrozen(items[0]!.profile)).toBe(true)
  })

  it('sends the edited name and address only when a relink opts into updating them', () => {
    const draft = createImportReviewDraft([relinkCandidate])
    const items = buildConfirmedImportItems({
      profileAcknowledged: true,
      items: [
        {
          ...draft.items[0]!,
          updateExistingProfile: true,
          name: '  Cedar   House ',
          address: '',
        },
      ],
    })

    expect(items[0]).toEqual({
      candidateRef: 'candidate.relink',
      action: 'relink',
      existingPropertyId: '10000000-0000-4000-8000-000000000002',
      profile: {
        name: 'Cedar House',
        address: null,
        timezone: 'Europe/Lisbon',
        confirmed: true,
        updateExistingProfile: true,
      },
    })
  })
})
