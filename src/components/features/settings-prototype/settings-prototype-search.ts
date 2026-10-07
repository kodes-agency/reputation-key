// PROTOTYPE — delete after the decision. The prototype's URL: which variant, which
// fixture workspace, which viewer, and where in Settings. Every key is optional so a
// bare /settings-prototype is the default view (variant A, 1 property, AccountAdmin).
import { z } from 'zod/v4'
import {
  SECTION_KEYS,
  type PrototypeProps,
  type PrototypeRole,
  type PrototypeScope,
  type PrototypeVariant,
  type SectionKey,
} from './settings-prototype-types'

export const PROTOTYPE_VARIANTS = ['A', 'B', 'C'] as const
export const PROTOTYPE_PROPS = ['1', '5', '60', 'real'] as const
export const PROTOTYPE_ROLES = ['aa', 'pm'] as const

// The router parses `?props=5` into the number 5, so a number is turned back into the
// string the enum lists before it is checked.
const numberAsString = (value: unknown): unknown =>
  typeof value === 'number' ? String(value) : value

export const settingsPrototypeSearchSchema = z.object({
  variant: z.enum(PROTOTYPE_VARIANTS).optional().catch(undefined),
  props: z
    .preprocess(numberAsString, z.enum(PROTOTYPE_PROPS))
    .optional()
    .catch(undefined),
  role: z.enum(PROTOTYPE_ROLES).optional().catch(undefined),
  /** A section key; one the viewer cannot see resolves to the first row. */
  section: z.string().max(40).optional().catch(undefined),
  /** A property id; an unknown one resolves to the first property. */
  property: z.string().max(80).optional().catch(undefined),
  scope: z.enum(['property', 'all']).optional().catch(undefined),
})

export type SettingsPrototypeSearch = z.infer<typeof settingsPrototypeSearchSchema>

export type RequestedSearch = Readonly<{
  variant: PrototypeVariant
  props: PrototypeProps
  role: PrototypeRole
  section: SectionKey | undefined
  property: string | undefined
  scope: PrototypeScope | undefined
}>

const SECTION_KEY_SET: ReadonlySet<string> = new Set(SECTION_KEYS)

/** The search with its defaults applied; nothing is checked against the fixtures yet. */
export function requestedSearchOf(search: SettingsPrototypeSearch): RequestedSearch {
  return {
    variant: search.variant ?? 'A',
    props: search.props ?? '1',
    role: search.role ?? 'aa',
    section:
      search.section !== undefined && SECTION_KEY_SET.has(search.section)
        ? (search.section as SectionKey)
        : undefined,
    property: search.property,
    scope: search.scope,
  }
}
