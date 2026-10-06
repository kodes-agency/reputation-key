// PROTOTYPE — variant B (Settings home). The page has no rail, so "where am I" is two
// facts from the URL: whether a section is open, and which property the per-property
// groups belong to. This module settles both and builds the three contexts the pieces
// draw from: the home's (one property's tiles), the all-properties one (the overview
// block) and the open section's, which the shared renderers take.
import { setupProgressOf } from '../../settings-prototype-fixtures'
import { buildSettingsPrototypeContext, hrefOf } from '../../settings-prototype-model'
import type { RequestedSearch } from '../../settings-prototype-search'
import type {
  PropertyFixture,
  PrototypeScope,
  RailRow,
  SectionKey,
  SettingsPrototypeContext,
  SetupStepKey,
} from '../../settings-prototype-types'

/** The part of the URL a link changes. A key left out keeps what the URL has. */
export type BTarget = Readonly<{
  section?: SectionKey | undefined
  scope?: PrototypeScope | undefined
  property?: string | undefined
}>

/** The two rows that only exist across all properties. Every other row is one property's, or the person's. */
const ALL_ONLY: ReadonlySet<SectionKey> = new Set<SectionKey>([
  'overview',
  'default-targets',
])

export const isAllOnly = (key: SectionKey): boolean => ALL_ONLY.has(key)

/** The words a row goes by. The default targets are not the property's own, and say so. */
export const labelOf = (row: Pick<RailRow, 'key' | 'label'>): string =>
  row.key === 'default-targets' ? 'Default response targets' : row.label

/** Business rows are about one property, so a property switcher belongs on their pages. */
export const isPropertyRow = (row: Pick<RailRow, 'group'>): boolean =>
  row.group === 'business'

export type SettingsHome = Readonly<{
  /** The property the per-property groups are about; null only for a workspace with none. */
  property: PropertyFixture | null
  /** Property scope: this property's tiles, status lines, setup meter. */
  ctx: SettingsPrototypeContext
  /** All-properties scope, when the viewer has one (AccountAdmin with 2+ properties). */
  all: SettingsPrototypeContext | null
  /** The open section's context, or null for the home. */
  open: SettingsPrototypeContext | null
}>

/** A section is open only when the URL names one this viewer can see; anything else is the home. */
export function resolveHome(
  requested: RequestedSearch,
  base: SettingsPrototypeContext,
): SettingsHome {
  const { data, shape } = base
  const property =
    data.properties.find((p) => p.id === requested.property) ?? data.properties[0] ?? null
  const contextFor = (
    section: SectionKey | undefined,
    scope: PrototypeScope,
  ): SettingsPrototypeContext =>
    buildSettingsPrototypeContext({
      search: { ...requested, section, scope, property: property?.id },
      data,
    })
  const key = requested.section
  const isOpenable =
    key !== undefined &&
    (shape.rows.property.includes(key) || shape.rows.all.includes(key))
  return {
    property,
    ctx: contextFor(undefined, 'property'),
    all: shape.showAllProperties ? contextFor('overview', 'all') : null,
    open: isOpenable ? contextFor(key, isAllOnly(key) ? 'all' : 'property') : null,
  }
}

/**
 * Where a row leads. The all-properties rows drop the property from their address,
 * so the one the person was looking at is put back: Back to Settings returns to it.
 */
export function targetOf(
  row: RailRow,
  home: Pick<SettingsHome, 'property'>,
  ctx: SettingsPrototypeContext,
): BTarget {
  if (isAllOnly(row.key) && ctx.shape.showPropertySwitcher) {
    return { ...row.href, property: home.property?.id }
  }
  return row.href
}

/** A row of the all-properties scope: the overview matrix, the default targets. */
export function allRowsOf(all: SettingsPrototypeContext | null): readonly RailRow[] {
  return all?.rail.groups.find((group) => group.key === 'all')?.rows ?? []
}

export const STEP_SENTENCE: Readonly<Record<SetupStepKey, string>> = {
  details: 'confirm the business details',
  google: 'link Google',
  language: 'choose the reply language',
  voice: 'set the reply voice',
  ai: 'decide about AI',
  people: 'add a responsible manager',
  portal: 'publish a portal',
}

/** "Set the reply voice": the next step of a property's setup, or null when it is done. */
export function nextStepOf(
  property: PropertyFixture,
  ctx: SettingsPrototypeContext,
): SetupStepKey | null {
  return setupProgressOf(property, ctx.data.viewer.role).nextStep
}

/** Where a property's row in the worklist leads: the section of its next step. */
export function nextStepTarget(
  property: PropertyFixture,
  ctx: SettingsPrototypeContext,
  section: SectionKey,
): BTarget {
  return hrefOf(ctx.shape, section, 'property', property.id)
}
