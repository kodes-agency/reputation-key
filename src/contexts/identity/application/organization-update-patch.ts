// Identity context — OrganizationUpdatePatch builder
// Deep module: maps the 9 optional organization-update fields to Better Auth
// payload semantics. The use case (and future callers) no longer know which
// fields are truthy-gated vs defined-gated vs always-present, or which ones
// normalize null → undefined.
//
// Field-inclusion table:
//
//   field              include when   value mapping
//   name               truthy         as-is
//   slug               truthy         as-is
//   logo               always         null → undefined
//   contactEmail       defined        null → undefined
//   billingCompanyName defined        null → undefined
//   billingAddress     defined        null → undefined
//   billingCity        defined        null → undefined
//   billingPostalCode  defined        null → undefined
//   billingCountry     defined        null → undefined
//   responseSlaHours   defined        as-is

export type UpdateOrganizationInput = Readonly<{
  name?: string
  slug?: string
  logo?: string | null
  contactEmail?: string | null
  billingCompanyName?: string | null
  billingAddress?: string | null
  billingCity?: string | null
  billingPostalCode?: string | null
  billingCountry?: string | null
  /** Response SLA in hours for unanswered-review alerts. Positive integer. */
  responseSlaHours?: number
}>

type Inclusion = 'truthy' | 'defined' | 'always'

type FieldSpec = Readonly<{
  field: keyof UpdateOrganizationInput
  include: Inclusion
  nullToUndefined: boolean
}>

const FIELD_SPECS: ReadonlyArray<FieldSpec> = [
  { field: 'name', include: 'truthy', nullToUndefined: false },
  { field: 'slug', include: 'truthy', nullToUndefined: false },
  { field: 'logo', include: 'always', nullToUndefined: true },
  { field: 'contactEmail', include: 'defined', nullToUndefined: true },
  { field: 'billingCompanyName', include: 'defined', nullToUndefined: true },
  { field: 'billingAddress', include: 'defined', nullToUndefined: true },
  { field: 'billingCity', include: 'defined', nullToUndefined: true },
  { field: 'billingPostalCode', include: 'defined', nullToUndefined: true },
  { field: 'billingCountry', include: 'defined', nullToUndefined: true },
  { field: 'responseSlaHours', include: 'defined', nullToUndefined: false },
]

function shouldInclude(spec: FieldSpec, value: unknown): boolean {
  switch (spec.include) {
    case 'always':
      return true
    case 'defined':
      return value !== undefined
    case 'truthy':
      return Boolean(value)
  }
}

/** Build the Better Auth update payload for the given input — see the table above. */
export function buildOrganizationUpdatePatch(
  input: UpdateOrganizationInput,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const spec of FIELD_SPECS) {
    const value = input[spec.field]
    if (!shouldInclude(spec, value)) continue
    patch[spec.field] = spec.nullToUndefined ? (value ?? undefined) : value
  }
  return patch
}
