// PROTOTYPE — delete after the decision. Shared vocabulary of the concept-D
// Settings prototype: the URL fixtures, the section keys, the fixture records and
// the context every variant receives. Types only; no behaviour lives here.
import type { ComponentType } from 'react'

export type PrototypeVariant = 'A' | 'B' | 'C'
/** `?props=`: how many properties the fixture workspace has. `real` is the live list, unpadded. */
export type PrototypeProps = '1' | '5' | '60' | 'real'
/** `?role=`: `aa` is an AccountAdmin, `pm` a PropertyManager with two granted properties. */
export type PrototypeRole = 'aa' | 'pm'
/** `?scope=`: the rail shows one property's sections, or the all-properties views. */
export type PrototypeScope = 'property' | 'all'

/** How many properties the viewer works across decides the shape of Settings. */
export type SettingsTier = 'single' | 'few' | 'many'

export const SECTION_KEYS = [
  // All properties (2+ properties, AccountAdmin)
  'overview',
  'default-targets',
  // Business / Property
  'details',
  'google',
  'replies',
  'ai',
  'people',
  'look',
  'targets',
  'portals',
  // Team
  'team',
  'workspace',
  'google-accounts',
  // You
  'profile',
  'notifications',
  'security',
  // Footer
  'add-location',
  'danger',
] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

export type RowGroup = 'all' | 'business' | 'team' | 'you' | 'footer'

/** ok = nothing to do, needs = a step to finish, draft = unpublished changes, locked = read-only for this viewer. */
export type RowTone = 'ok' | 'needs' | 'draft' | 'locked'

/** What a viewer may do with a section: change it, read it (locked) or not see it. */
export type SectionAccess = 'edit' | 'lock' | 'omit'

/** The part of the URL a row changes. Merge it into the previous search to navigate. */
export type SettingsPrototypeHref = Readonly<{
  section: SectionKey
  scope: PrototypeScope | undefined
  property: string | undefined
}>

export type SetupStepKey =
  'details' | 'google' | 'language' | 'voice' | 'ai' | 'people' | 'portal'

// ── Fixtures ────────────────────────────────────────────────────────────

export type PropertyKind = 'hotel' | 'restaurant' | 'salon'
export type GoogleState = 'linked' | 'not_linked' | 'needs_reconnect'
export type AiState = 'on' | 'off' | 'undecided'
export type LookState = 'published' | 'draft' | 'none'

export type PropertyFixture = Readonly<{
  id: string
  name: string
  /** True when the id, name and address come from the live properties list. */
  isReal: boolean
  kind: PropertyKind
  city: string
  country: string
  address: string
  timezone: string
  google: Readonly<{
    state: GoogleState
    accountId: string
    listingName: string | null
    reviewCount: number
  }>
  /** The reply language, or null when none is confirmed. */
  language: string | null
  voice: Readonly<{ greeting: string; signOff: string }> | null
  ai: AiState
  /** How many of the three AI tools are on. */
  aiTools: number
  managerIds: readonly string[]
  look: LookState
  targets: Readonly<{
    mode: 'default' | 'custom'
    privateFeedbackHours: number
    googleReviewsHours: number
  }>
  portals: Readonly<{ live: number; toPublish: number; names: readonly string[] }>
  steps: Readonly<Record<SetupStepKey, boolean>>
}>

export type MemberFixture = Readonly<{
  id: string
  name: string
  email: string
  role: 'AccountAdmin' | 'PropertyManager' | 'Member'
  status: 'active' | 'invited'
  /** The viewer's own row. */
  isViewer: boolean
}>

export type GoogleAccountFixture = Readonly<{
  id: string
  email: string
  propertyCount: number
}>

export type WorkspaceFixture = Readonly<{
  name: string
  slug: string
  contactEmail: string
  /** Who a PropertyManager is told to ask. */
  adminName: string
  defaults: Readonly<{ privateFeedbackHours: number; googleReviewsHours: number }>
  aiBudget: Readonly<{ usedPercent: number; label: string }>
}>

export type SettingsPrototypeData = Readonly<{
  viewer: Readonly<{ name: string; email: string; role: PrototypeRole }>
  workspace: WorkspaceFixture
  /** Every property in the workspace. */
  allProperties: readonly PropertyFixture[]
  /** The properties this viewer can open: all of them, or the two a manager is granted. */
  properties: readonly PropertyFixture[]
  members: readonly MemberFixture[]
  googleAccounts: readonly GoogleAccountFixture[]
}>

// ── Shape and rail ──────────────────────────────────────────────────────

export type SettingsShape = Readonly<{
  role: PrototypeRole
  propertyCount: number
  tier: SettingsTier
  /** Two or more properties the viewer can open: a switcher, section-keeping. */
  showPropertySwitcher: boolean
  /** The switcher's first entry: All properties (Overview and the default targets). */
  showAllProperties: boolean
  /** Ten or more properties: Overview is a filterable matrix with bulk apply. */
  showMatrix: boolean
  /** Business at one property, Property once a switcher exists. */
  businessLabel: 'Business' | 'Property'
  access: Readonly<Record<SectionKey, SectionAccess>>
  /** Row order per scope, with the rows the viewer cannot see already left out. */
  rows: Readonly<Record<PrototypeScope, readonly SectionKey[]>>
}>

export type RailRow = Readonly<{
  key: SectionKey
  label: string
  group: RowGroup
  /** The line under the label: Linked, 214 reviews. */
  statusText: string
  tone: RowTone
  locked: boolean
  href: SettingsPrototypeHref
  /** Portals opens another page in the real product; here it is a content card. */
  isLinkOut: boolean
}>

export type RailGroup = Readonly<{
  key: RowGroup
  label: string
  rows: readonly RailRow[]
}>

export type SettingsRail = Readonly<{
  scope: PrototypeScope
  /** BUSINESS / PROPERTY or ALL PROPERTIES, TEAM, YOU, then the footer group. */
  groups: readonly RailGroup[]
  /** `Setup n of 7`, shown until the property is done. Null in the all-properties scope. */
  setup: Readonly<{
    done: number
    total: number
    isComplete: boolean
    nextKey: SectionKey | null
    nextHref: SettingsPrototypeHref | null
  }> | null
  /** The switcher entries when the shape has one: All properties first, then each property. */
  switcher: Readonly<{
    all: Readonly<{
      label: string
      needSetup: number
      href: SettingsPrototypeHref
    }> | null
    items: ReadonlyArray<
      Readonly<{
        id: string
        name: string
        done: number
        total: number
        href: SettingsPrototypeHref
      }>
    >
    currentId: string | null
    /** The next property that still has a setup step to finish, if any. */
    nextToFinishHref: SettingsPrototypeHref | null
  }> | null
}>

// ── What a variant receives ─────────────────────────────────────────────

export type SettingsPrototypeState = Readonly<{
  variant: PrototypeVariant
  props: PrototypeProps
  role: PrototypeRole
  scope: PrototypeScope
  section: SectionKey
  /** The property in scope; null in the all-properties scope. */
  propertyId: string | null
}>

export type SettingsPrototypeContext = Readonly<{
  state: SettingsPrototypeState
  shape: SettingsShape
  rail: SettingsRail
  data: SettingsPrototypeData
  /** The property in scope, or null in the all-properties scope. */
  property: PropertyFixture | null
  /** The open row (every state resolves to one). */
  current: RailRow
  /** Every row of the rail, flat, footer included. */
  rows: readonly RailRow[]
}>

export type SettingsPrototypeVariantProps = Readonly<{ ctx: SettingsPrototypeContext }>

export type SettingsPrototypeVariantEntry = Readonly<{
  Component: ComponentType<SettingsPrototypeVariantProps>
  name: string
}>
