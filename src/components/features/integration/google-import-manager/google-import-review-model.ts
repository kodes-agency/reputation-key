import { isValidIanaTimezone } from '#/shared/domain/timezones'
import type {
  ImportCandidateDto,
  StartPropertyImportItemInput,
} from '#/contexts/integration/application/public-api'

const ISO_COUNTRY_CODES = new Set(
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(
    ' ',
  ),
)
const whitespace = /\s+/gu

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(whitespace, ' ')
}

export type ImportReviewItem = {
  readonly candidateId: string
  readonly candidateRef: string
  readonly action: 'create' | 'relink'
  readonly existingPropertyId: string | null
  name: string
  address: string
  countryCode: string
  timezone: string
  countryConfirmed: boolean
  timezoneConfirmed: boolean
  updateExistingProfile: boolean
}

export type ImportReviewDraft = { items: ImportReviewItem[] }

export type ImportReviewValidation = Readonly<{
  valid: boolean
  errors: Readonly<Record<string, string>>
  firstInvalidControlId: string | null
}>

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

function addError(
  errors: Record<string, string>,
  item: ImportReviewItem,
  field: string,
  message: string,
): void {
  errors[`${item.candidateId}.${field}`] = message
}

export const reviewControlId = (candidateId: string, field: string): string =>
  `import-${field}-${candidateId}`

export function validateImportReviewDraft(
  draft: ImportReviewDraft,
): ImportReviewValidation {
  const errors: Record<string, string> = {}
  const controlOrder: Array<readonly [string, string]> = []

  for (const item of draft.items) {
    const normalizedName = normalizeText(item.name)
    const normalizedAddress = normalizeText(item.address)
    const fields = [
      'name',
      'address',
      'countryCode',
      'timezone',
      'countryConfirmed',
      'timezoneConfirmed',
    ] as const
    for (const field of fields) {
      controlOrder.push([
        `${item.candidateId}.${field}`,
        reviewControlId(item.candidateId, field),
      ])
    }

    if ((item.action === 'create' || item.updateExistingProfile) && !normalizedName) {
      addError(errors, item, 'name', 'Enter a property name.')
    } else if (normalizedName.length > 100) {
      addError(errors, item, 'name', 'Property name must be 100 characters or fewer.')
    }
    if (normalizedAddress.length > 500) {
      addError(errors, item, 'address', 'Address must be 500 characters or fewer.')
    }
    if (item.action === 'create') {
      if (!ISO_COUNTRY_CODES.has(item.countryCode.trim().toUpperCase())) {
        addError(errors, item, 'countryCode', 'Select a valid country.')
      }
      if (!item.countryConfirmed) {
        addError(errors, item, 'countryConfirmed', 'Confirm the selected country.')
      }
    }
    if (!isValidIanaTimezone(item.timezone)) {
      addError(errors, item, 'timezone', 'Select a valid IANA timezone.')
    }
    if (!item.timezoneConfirmed) {
      addError(errors, item, 'timezoneConfirmed', 'Confirm the selected timezone.')
    }
  }

  return {
    valid: Object.keys(errors).length === 0 && draft.items.length > 0,
    errors,
    firstInvalidControlId:
      controlOrder.find(([key]) => errors[key] !== undefined)?.[1] ?? null,
  }
}

function freezeItem(item: StartPropertyImportItemInput): StartPropertyImportItemInput {
  Object.freeze(item.profile)
  return Object.freeze(item)
}

export function buildConfirmedImportItems(
  draft: ImportReviewDraft,
): readonly StartPropertyImportItemInput[] {
  const validation = validateImportReviewDraft(draft)
  if (!validation.valid) throw new Error('Google import review is incomplete')

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
      existingPropertyId: item.existingPropertyId as never,
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

export const IMPORT_COUNTRY_CODES = Object.freeze([...ISO_COUNTRY_CODES].sort())
