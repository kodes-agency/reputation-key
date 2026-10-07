// PROTOTYPE — delete after the decision. Turns the URL, the fixtures and the shape
// into the one object every variant renders from: the rail (groups, rows, status
// lines, setup meter, property switcher) and the open section. Pure; no React.
import { setupProgressOf } from './settings-prototype-fixtures'
import type { RequestedSearch } from './settings-prototype-search'
import {
  SECTION_GROUP,
  SECTION_LABEL,
  settingsShapeFor,
} from './settings-prototype-shape'
import {
  SECTION_OF_STEP,
  propertiesNeedingSetup,
  statusFor,
} from './settings-prototype-status'
import type {
  PropertyFixture,
  PrototypeScope,
  RailGroup,
  RailRow,
  RowGroup,
  SectionKey,
  SettingsPrototypeContext,
  SettingsPrototypeData,
  SettingsPrototypeHref,
  SettingsRail,
  SettingsShape,
} from './settings-prototype-types'

type RailInput = Readonly<{
  shape: SettingsShape
  data: SettingsPrototypeData
  scope: PrototypeScope
  property: PropertyFixture | null
}>

/** The URL part a row changes. A single property needs neither a scope nor a property id. */
export function hrefOf(
  shape: SettingsShape,
  section: SectionKey,
  scope: PrototypeScope,
  propertyId: string | null,
): SettingsPrototypeHref {
  const explicit = shape.showPropertySwitcher
  return {
    section,
    scope: explicit ? scope : undefined,
    property: explicit && scope === 'property' ? (propertyId ?? undefined) : undefined,
  }
}

function groupLabel(group: RowGroup, shape: SettingsShape): string {
  if (group === 'all') return 'All properties'
  if (group === 'business') return shape.businessLabel
  if (group === 'team') return 'Team'
  return group === 'you' ? 'You' : ''
}

const GROUP_ORDER: readonly RowGroup[] = ['all', 'business', 'team', 'you', 'footer']

function rowOf(key: SectionKey, input: RailInput): RailRow {
  const { shape, data, scope, property } = input
  const locked = shape.access[key] === 'lock'
  const status = statusFor({ key, property, shape, data, locked })
  return {
    key,
    label: SECTION_LABEL[key],
    group: SECTION_GROUP[key],
    statusText: status.text,
    tone: status.tone,
    locked,
    href: hrefOf(shape, key, scope, property?.id ?? null),
    isLinkOut: key === 'portals',
  }
}

/** Where "Next" goes for a property: the row of its first unfinished step. */
function nextHrefFor(
  property: PropertyFixture,
  shape: SettingsShape,
  data: SettingsPrototypeData,
): SettingsPrototypeHref | null {
  const { nextStep } = setupProgressOf(property, data.viewer.role)
  return nextStep === null
    ? null
    : hrefOf(shape, SECTION_OF_STEP[nextStep], 'property', property.id)
}

function switcherOf(input: RailInput, current: SectionKey) {
  const { shape, data, property } = input
  if (!shape.showPropertySwitcher) return null
  // The switcher keeps the section: the same row of the other property.
  const keep: SectionKey = shape.rows.property.includes(current) ? current : 'details'
  const needing = propertiesNeedingSetup(data)
  const next = needing.find((p) => p.id !== property?.id) ?? null
  return {
    all: shape.showAllProperties
      ? {
          label: 'All properties',
          needSetup: needing.length,
          href: hrefOf(shape, 'overview', 'all', null),
        }
      : null,
    items: data.properties.map((p) => {
      const progress = setupProgressOf(p, data.viewer.role)
      return {
        id: p.id,
        name: p.name,
        done: progress.done,
        total: progress.total,
        href: hrefOf(shape, keep, 'property', p.id),
      }
    }),
    currentId: property?.id ?? null,
    nextToFinishHref: next === null ? null : nextHrefFor(next, shape, data),
  }
}

export function buildRail(input: RailInput, current: SectionKey): SettingsRail {
  const { shape, data, scope, property } = input
  const keys = shape.rows[scope]
  const groups: RailGroup[] = GROUP_ORDER.flatMap((group) => {
    const rows = keys
      .filter((key) => SECTION_GROUP[key] === group)
      .map((key) => rowOf(key, input))
    return rows.length === 0
      ? []
      : [{ key: group, label: groupLabel(group, shape), rows }]
  })
  const progress = property === null ? null : setupProgressOf(property, data.viewer.role)
  return {
    scope,
    groups,
    setup:
      property === null || progress === null
        ? null
        : {
            done: progress.done,
            total: progress.total,
            isComplete: progress.nextStep === null,
            nextKey:
              progress.nextStep === null ? null : SECTION_OF_STEP[progress.nextStep],
            nextHref: nextHrefFor(property, shape, data),
          },
    switcher: switcherOf(input, current),
  }
}

type ContextInput = Readonly<{ search: RequestedSearch; data: SettingsPrototypeData }>

/** Everything a variant needs, resolved against the fixtures so no URL can break it. */
export function buildSettingsPrototypeContext({
  search,
  data,
}: ContextInput): SettingsPrototypeContext {
  const shape = settingsShapeFor({
    role: search.role,
    propertyCount: data.properties.length,
  })
  const scope: PrototypeScope =
    shape.showAllProperties && (search.scope ?? 'all') === 'all' ? 'all' : 'property'
  const property =
    scope === 'all'
      ? null
      : (data.properties.find((p) => p.id === search.property) ??
        data.properties[0] ??
        null)
  const input: RailInput = { shape, data, scope, property }
  const keys = shape.rows[scope]
  const nextKey =
    property === null
      ? null
      : SECTION_OF_STEP[setupProgressOf(property, search.role).nextStep ?? 'details']
  const fallback = scope === 'all' ? 'overview' : (nextKey ?? 'details')
  const requested = search.section !== undefined && keys.includes(search.section)
  const section = requested
    ? (search.section ?? fallback)
    : keys.includes(fallback)
      ? fallback
      : (keys[0] ?? 'details')
  const rail = buildRail(input, section)
  const rows = rail.groups.flatMap((group) => group.rows)
  const current = rows.find((row) => row.key === section) ?? rows[0]
  if (current === undefined) throw new Error('settings prototype: the shape has no rows')
  return {
    state: {
      variant: search.variant,
      props: search.props,
      role: search.role,
      scope,
      section: current.key,
      propertyId: property?.id ?? null,
    },
    shape,
    rail,
    data,
    property,
    current,
    rows,
  }
}
