import { isValidIanaTimezone } from '#/shared/domain/timezones'
import { z } from 'zod/v4'

const ISO_COUNTRY_CODES = new Set(
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(
    ' ',
  ),
)

const OPAQUE_REFERENCE = /^[a-z][a-z0-9_-]{0,31}\.[A-Za-z0-9_-]{43}$/
const whitespace = /\s+/gu

function normalizeTenantText(value: string): string {
  return value.normalize('NFKC').trim().replace(whitespace, ' ')
}

const normalizedText = (max: number) =>
  z.string().transform(normalizeTenantText).pipe(z.string().min(1).max(max))

const nullableNormalizedText = (max: number) => z.union([normalizedText(max), z.null()])

const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidIanaTimezone, 'Invalid IANA timezone')

const countryCodeSchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(
    z
      .string()
      .length(2)
      .refine((value) => ISO_COUNTRY_CODES.has(value), 'Invalid ISO country code'),
  )

const candidateRefSchema = z.string().min(1).max(80).regex(OPAQUE_REFERENCE)

const createProfileSchema = z
  .object({
    name: normalizedText(100),
    address: nullableNormalizedText(500),
    countryCode: countryCodeSchema,
    timezone: timezoneSchema,
    confirmed: z.literal(true),
  })
  .strict()

const preserveRelinkProfileSchema = z
  .object({
    timezone: timezoneSchema,
    confirmed: z.literal(true),
    updateExistingProfile: z.literal(false),
  })
  .strict()

const updateRelinkProfileSchema = z
  .object({
    name: normalizedText(100),
    address: nullableNormalizedText(500),
    timezone: timezoneSchema,
    confirmed: z.literal(true),
    updateExistingProfile: z.literal(true),
  })
  .strict()

const relinkProfileSchema = z.discriminatedUnion('updateExistingProfile', [
  preserveRelinkProfileSchema,
  updateRelinkProfileSchema,
])

const startItemSchema = z.discriminatedUnion('action', [
  z
    .object({
      candidateRef: candidateRefSchema,
      action: z.literal('create'),
      profile: createProfileSchema,
    })
    .strict(),
  z
    .object({
      candidateRef: candidateRefSchema,
      action: z.literal('relink'),
      existingPropertyId: z.uuid(),
      profile: relinkProfileSchema,
    })
    .strict(),
])

export const startPropertyImportInputSchema = z
  .object({
    requestId: z.uuid(),
    items: z.array(startItemSchema).min(1).max(100),
    confirmation: z.literal('apply'),
  })
  .strict()
  .superRefine((value, context) => {
    const refs = new Set<string>()
    for (const [index, item] of value.items.entries()) {
      if (refs.has(item.candidateRef)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'candidateRef'],
          message: 'Candidate references must be unique',
        })
      }
      refs.add(item.candidateRef)
    }
  })

export const recoverPropertyImportInputSchema = z.object({ requestId: z.uuid() }).strict()

export const getPropertyImportStatusInputSchema = z
  .object({ importJobId: z.uuid() })
  .strict()

export const retryPropertyImportItemInputSchema = z
  .object({
    itemId: z.uuid(),
    retryRequestId: z.uuid(),
    expectedRetryRevision: z.number().int().nonnegative().lte(Number.MAX_SAFE_INTEGER),
  })
  .strict()

export type StartPropertyImportV2Input = z.infer<typeof startPropertyImportInputSchema>
export type RecoverPropertyImportInput = z.infer<typeof recoverPropertyImportInputSchema>
export type GetPropertyImportStatusInput = z.infer<
  typeof getPropertyImportStatusInputSchema
>
export type RetryPropertyImportItemInput = z.infer<
  typeof retryPropertyImportItemInputSchema
>
