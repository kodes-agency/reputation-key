import type { PropertyId } from '#/shared/domain/ids'
import {
  defaultTimezoneForCountry,
  timezonesForCountry,
} from '#/shared/domain/country-timezones'
import type {
  ImportCandidateDto,
  StartPropertyImportItemInput,
} from '#/contexts/integration/application/public-api'
import {
  GOOGLE_IMPORT_COUNTRY_CODES,
  googleImportReviewDraftSchema,
  googleImportReviewItemSchema,
  type GoogleImportReviewDraftInput,
} from '#/contexts/integration/application/dto/google-import-v2.dto'
const whitespace = /\s+/gu

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(whitespace, ' ')
}

export type ImportReviewDraft = GoogleImportReviewDraftInput
export type ImportReviewItem = ImportReviewDraft['items'][number]

/** The row controls a live completeness issue can point at. */
export type ImportReviewField = 'name' | 'address' | 'countryCode' | 'timezone'

export type ImportReviewItemIssues = Readonly<Partial<Record<ImportReviewField, string>>>

function selectableCandidate(
  candidate: ImportCandidateDto,
): candidate is ImportCandidateDto & { candidateRef: string } {
  return (
    candidate.candidateRef !== null &&
    (candidate.eligibility.kind === 'create' || candidate.eligibility.kind === 'relink')
  )
}

/**
 * A new property takes the country's only timezone and otherwise starts empty,
 * so the row stays flagged until the manager picks one. A relinked property
 * keeps the timezone it already has. The browser's own timezone is never a
 * default: it describes the manager's device, not the business.
 */
export function createImportReviewDraft(
  candidates: readonly ImportCandidateDto[],
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
          updateExistingProfile: false,
        }
      }
      const countryCode = candidate.countryCode?.trim().toUpperCase() ?? ''
      return {
        candidateId: candidate.candidateId,
        candidateRef: candidate.candidateRef,
        action: 'create',
        existingPropertyId: null,
        name: normalizeText(candidate.businessName),
        address: normalizeText(candidate.address ?? ''),
        countryCode,
        timezone: defaultTimezoneForCountry(countryCode) ?? '',
        updateExistingProfile: true,
      }
    }),
    profileAcknowledged: false,
  }
}

/**
 * The timezone a create row keeps after its country changes: the new country's
 * only zone, the current zone when it lies inside the new country, or empty.
 */
export function timezoneAfterCountryChange(
  countryCode: string,
  currentTimezone: string,
): string {
  const zones = timezonesForCountry(countryCode)
  if (zones.length === 1) return zones[0]!
  return zones.includes(currentTimezone) ? currentTimezone : ''
}

/**
 * Sets one timezone on every row — empty, flagged, and already chosen alike.
 * A bulk overwrite changes rows the manager may not have looked at since, so
 * the batch acknowledgement has to be given again.
 */
export function applyBulkTimezone(
  draft: ImportReviewDraft,
  timezone: string,
): ImportReviewDraft {
  return {
    items: draft.items.map((item) => ({ ...item, timezone })),
    profileAcknowledged: false,
  }
}

const REVIEW_FIELDS: ReadonlySet<string> = new Set<ImportReviewField>([
  'name',
  'address',
  'countryCode',
  'timezone',
])

/**
 * Live completeness of one row, keyed by the control that fixes each issue.
 * The DTO schema is the only rule source; this only reshapes its issues.
 */
export function reviewItemIssues(item: ImportReviewItem): ImportReviewItemIssues {
  const parsed = googleImportReviewItemSchema.safeParse(item)
  if (parsed.success) return {}
  const issues: Partial<Record<ImportReviewField, string>> = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0]
    if (typeof field !== 'string' || !REVIEW_FIELDS.has(field)) continue
    issues[field as ImportReviewField] ??= issue.message
  }
  // A malformed row that no control can fix still blocks the import.
  if (Object.keys(issues).length === 0) {
    issues.name = 'This location can no longer be imported. Go back to locations.'
  }
  return issues
}

export function countFlaggedReviewItems(items: readonly ImportReviewItem[]): number {
  return items.filter((item) => Object.keys(reviewItemIssues(item)).length > 0).length
}

export const reviewControlId = (candidateId: string, field: string): string =>
  `import-${field}-${candidateId}`

function freezeItem(item: StartPropertyImportItemInput): StartPropertyImportItemInput {
  Object.freeze(item.profile)
  return Object.freeze(item)
}

/**
 * Builds the durable start command. It refuses an incomplete table and an
 * unacknowledged one: `confirmed: true` on each item is the batch
 * acknowledgement carried onto every row it covered.
 */
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
