// Identity context — OrganizationUpdatePatch builder
// Deep module: maps the beta-supported organization-update fields to Better Auth
// payload semantics. The use case (and future callers) no longer know which
// fields are truthy-gated vs defined-gated vs always-present.
//
// Better Auth skips an `undefined` field on update, so only `null` clears a column:
// the logo and the contact email pass a null through (a null mapped to `undefined`
// saved nothing, and the removed value came back on reload).
//
// Field-inclusion table:
//
//   field              include when   value mapping
//   name               truthy         as-is
//   slug               truthy         as-is
//   logo               always         as-is: null clears it
//   contactEmail       defined        as-is: null clears it

export type UpdateOrganizationInput = Readonly<{
  name?: string
  slug?: string
  logo?: string | null
  contactEmail?: string | null
}>

type Inclusion = 'truthy' | 'defined' | 'always'

type FieldSpec = Readonly<{
  field: keyof UpdateOrganizationInput
  include: Inclusion
}>

const FIELD_SPECS: ReadonlyArray<FieldSpec> = [
  { field: 'name', include: 'truthy' },
  { field: 'slug', include: 'truthy' },
  { field: 'logo', include: 'always' },
  { field: 'contactEmail', include: 'defined' },
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
    patch[spec.field] = value
  }
  return patch
}
