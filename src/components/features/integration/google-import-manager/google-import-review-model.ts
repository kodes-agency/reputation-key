import type { PropertyId } from '#/shared/domain/ids'
import type {
  ImportCandidateDto,
  StartPropertyImportItemInput,
} from '#/contexts/integration/application/public-api'
import {
  GOOGLE_IMPORT_COUNTRY_CODES,
  googleImportReviewDraftSchema,
  type GoogleImportReviewDraftInput,
} from '#/contexts/integration/application/dto/google-import-v2.dto'
const whitespace = /\s+/gu

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(whitespace, ' ')
}

export type ImportReviewDraft = GoogleImportReviewDraftInput
export type ImportReviewItem = ImportReviewDraft['items'][number]

function selectableCandidate(
  candidate: ImportCandidateDto,
): candidate is ImportCandidateDto & { candidateRef: string } {
  return (
    candidate.candidateRef !== null &&
    (candidate.eligibility.kind === 'create' || candidate.eligibility.kind === 'relink')
  )
}

export function createImportReviewDraft(
  candidates: readonly ImportCandidateDto[],
  browserTimezone: string,
): ImportReviewDraft {
  return {
    items: candidates.filter(selectableCandidate).map((candidate) => {
      if (candidate.eligibility.kind === 'relink') {
        return {
          candidateId: candidate.candidateId,
          candidateRef: candidate.candidateRef,
          action: 'relink',
          existingPropertyId: candidate.eligibility.propertyId,
          name: normalizeText(candidate.eligibility.profile.name),
          address: normalizeText(candidate.eligibility.profile.address ?? ''),
          countryCode: candidate.eligibility.profile.countryCode?.toUpperCase() ?? '',
          timezone: candidate.eligibility.profile.timezone,
          countryConfirmed: true,
          timezoneConfirmed: false,
          updateExistingProfile: false,
        }
      }
      return {
        candidateId: candidate.candidateId,
        candidateRef: candidate.candidateRef,
        action: 'create',
        existingPropertyId: null,
        name: normalizeText(candidate.businessName),
        address: normalizeText(candidate.address ?? ''),
        countryCode: candidate.countryCode?.trim().toUpperCase() ?? '',
        timezone: browserTimezone,
        countryConfirmed: false,
        timezoneConfirmed: false,
        updateExistingProfile: true,
      }
    }),
  }
}

export function applyBulkTimezone(
  draft: ImportReviewDraft,
  timezone: string,
): ImportReviewDraft {
  return {
    items: draft.items.map((item) => ({
      ...item,
      timezone,
      timezoneConfirmed: false,
    })),
  }
}

export const reviewControlId = (candidateId: string, field: string): string =>
  `import-${field}-${candidateId}`

function freezeItem(item: StartPropertyImportItemInput): StartPropertyImportItemInput {
  Object.freeze(item.profile)
  return Object.freeze(item)
}

export function buildConfirmedImportItems(
  draft: ImportReviewDraft,
): readonly StartPropertyImportItemInput[] {
  googleImportReviewDraftSchema.parse(draft)

  const items = draft.items.map((item): StartPropertyImportItemInput => {
    const name = normalizeText(item.name)
    const address = normalizeText(item.address) || null
    if (item.action === 'create') {
      return freezeItem({
        candidateRef: item.candidateRef,
        action: 'create',
        profile: {
          name,
          address,
          countryCode: item.countryCode.trim().toUpperCase(),
          timezone: item.timezone,
          confirmed: true,
        },
      })
    }
    if (!item.existingPropertyId) throw new Error('Relink property is missing')
    return freezeItem({
      candidateRef: item.candidateRef,
      action: 'relink',
      existingPropertyId: item.existingPropertyId as PropertyId,
      profile: item.updateExistingProfile
        ? {
            name,
            address,
            timezone: item.timezone,
            confirmed: true,
            updateExistingProfile: true,
          }
        : {
            timezone: item.timezone,
            confirmed: true,
            updateExistingProfile: false,
          },
    })
  })
  return Object.freeze(items)
}

export const IMPORT_COUNTRY_CODES = GOOGLE_IMPORT_COUNTRY_CODES
