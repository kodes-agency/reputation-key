// PROTOTYPE — delete after the decision. Concept D: Settings works out its own shape
// from the viewer's role and how many properties they can open. The user never picks
// a scope; this one pure function decides which rows exist, in which group, in which
// order and whether the viewer may change them.
//
//   1 property    Business / Team / You, no switcher, no "organization" wording.
//   2-10          the group is PROPERTY, headed by a switcher whose first entry is
//                 All properties (Overview table + the default Response targets).
//   10+ (admin)   Overview becomes a filterable matrix with bulk apply.
//   PropertyManager  only granted properties; org-only sections are locked (read-only
//                 with who to ask) when they constrain the work, omitted otherwise.
import type {
  RowGroup,
  SectionAccess,
  SectionKey,
  SettingsShape,
  SettingsTier,
  PrototypeRole,
} from './settings-prototype-types'

export const SECTION_LABEL: Readonly<Record<SectionKey, string>> = {
  overview: 'Overview',
  'default-targets': 'Response targets',
  details: 'Details',
  google: 'Google',
  replies: 'Replies',
  ai: 'AI',
  people: 'People',
  look: 'Look & brand',
  targets: 'Response targets',
  portals: 'Portals',
  team: 'Team & access',
  workspace: 'Workspace',
  'google-accounts': 'Google accounts',
  profile: 'Profile',
  notifications: 'Notifications',
  security: 'Security',
  'add-location': 'Add another location',
  danger: 'Danger zone',
}

export const SECTION_GROUP: Readonly<Record<SectionKey, RowGroup>> = {
  overview: 'all',
  'default-targets': 'all',
  details: 'business',
  google: 'business',
  replies: 'business',
  ai: 'business',
  people: 'business',
  look: 'business',
  targets: 'business',
  portals: 'business',
  team: 'team',
  workspace: 'team',
  'google-accounts': 'team',
  profile: 'you',
  notifications: 'you',
  security: 'you',
  'add-location': 'footer',
  danger: 'footer',
}

const PROPERTY_ORDER: readonly SectionKey[] = [
  'details',
  'google',
  'replies',
  'ai',
  'people',
  'look',
  'targets',
  'portals',
  'team',
  'workspace',
  'google-accounts',
  'profile',
  'notifications',
  'security',
  'add-location',
  'danger',
]

const ALL_ORDER: readonly SectionKey[] = [
  'overview',
  'default-targets',
  'team',
  'workspace',
  'google-accounts',
  'profile',
  'notifications',
  'security',
  'add-location',
]

/** An AccountAdmin changes everything the shape offers. */
const ADMIN_ACCESS: Readonly<Record<SectionKey, SectionAccess>> = {
  overview: 'edit',
  'default-targets': 'edit',
  details: 'edit',
  google: 'edit',
  replies: 'edit',
  ai: 'edit',
  people: 'edit',
  look: 'edit',
  targets: 'edit',
  portals: 'edit',
  team: 'edit',
  workspace: 'edit',
  'google-accounts': 'edit',
  profile: 'edit',
  notifications: 'edit',
  security: 'edit',
  'add-location': 'edit',
  danger: 'edit',
}

/**
 * The one rule: read-only with a lock and who to ask when the section constrains
 * the manager's own work (Google, AI, Response targets, who is on the team);
 * omitted when it does not (Workspace, Google accounts, adding a location).
 */
const MANAGER_ACCESS: Readonly<Record<SectionKey, SectionAccess>> = {
  ...ADMIN_ACCESS,
  overview: 'omit',
  'default-targets': 'omit',
  google: 'lock',
  ai: 'lock',
  targets: 'lock',
  team: 'lock',
  workspace: 'omit',
  'google-accounts': 'omit',
  'add-location': 'omit',
}

export const FEW_PROPERTIES_FROM = 2
export const MANY_PROPERTIES_FROM = 11

export function tierFor(propertyCount: number): SettingsTier {
  if (propertyCount >= MANY_PROPERTIES_FROM) return 'many'
  return propertyCount >= FEW_PROPERTIES_FROM ? 'few' : 'single'
}

export function settingsShapeFor(
  input: Readonly<{ role: PrototypeRole; propertyCount: number }>,
): SettingsShape {
  const { role, propertyCount } = input
  const tier = tierFor(propertyCount)
  const isAdmin = role === 'aa'
  const showPropertySwitcher = tier !== 'single'
  const showAllProperties = isAdmin && showPropertySwitcher
  const base = isAdmin ? ADMIN_ACCESS : MANAGER_ACCESS
  // One property has no workspace of Google accounts to list: it is on the Google page.
  const access: Readonly<Record<SectionKey, SectionAccess>> = {
    ...base,
    ...(tier === 'single' ? { 'google-accounts': 'omit' as const } : {}),
    ...(showAllProperties
      ? {}
      : { overview: 'omit' as const, 'default-targets': 'omit' as const }),
  }
  const visible = (order: readonly SectionKey[]) =>
    order.filter((key) => access[key] !== 'omit')
  return {
    role,
    propertyCount,
    tier,
    showPropertySwitcher,
    showAllProperties,
    showMatrix: isAdmin && tier === 'many',
    businessLabel: showPropertySwitcher ? 'Property' : 'Business',
    access,
    rows: {
      property: visible(PROPERTY_ORDER),
      all: showAllProperties ? visible(ALL_ORDER) : [],
    },
  }
}
