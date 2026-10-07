// PROTOTYPE — delete after the decision. Deterministic fixtures for the Settings
// prototype: the same ?props and ?role always give the same workspace. Real data where
// it is cheap (the organization and user names, the live properties' ids, names and
// addresses); everything else is synthetic and derived from the property's index so
// 1 / 5 / 60 properties tell a believable story (a few need setup, some are not
// linked to Google, some have not decided about AI, some have their own targets).
import type {
  AiState,
  GoogleAccountFixture,
  GoogleState,
  LookState,
  MemberFixture,
  PropertyFixture,
  PropertyKind,
  PrototypeProps,
  PrototypeRole,
  SettingsPrototypeData,
  SetupStepKey,
} from './settings-prototype-types'

export type RealPropertyInput = Readonly<{
  id: string
  name: string
  address: string | null
  timezone: string
}>

export type FixtureInput = Readonly<{
  props: PrototypeProps
  role: PrototypeRole
  organizationName: string
  user: Readonly<{ name: string; email: string }>
  realProperties: readonly RealPropertyInput[]
}>

const PROPERTY_COUNT: Readonly<Record<Exclude<PrototypeProps, 'real'>, number>> = {
  '1': 1,
  '5': 5,
  '60': 60,
}
/** What a PropertyManager is granted. */
export const GRANTED_PROPERTIES = 2
export const SETUP_STEP_COUNT = 7
const DEFAULT_PRIVATE_FEEDBACK_HOURS = 24
const DEFAULT_GOOGLE_REVIEWS_HOURS = 48

type Hand = readonly [name: string, kind: PropertyKind]
const HAND_NAMED: readonly Hand[] = [
  ['Harbour Hotel Sofia', 'hotel'],
  ['Old Town Bistro', 'restaurant'],
  ['Cut & Co', 'salon'],
  ['Cafe Roma', 'restaurant'],
  ['Lindenhof Hotel', 'hotel'],
]
const HEADS = ['Harbour', 'Old Town', 'Riverside', 'Alpine', 'Sunset', 'Maple']
const HEADS_MORE = ['Copper', 'Willow', 'Lantern', 'Marina', 'Garden', 'Summit']
const TAILS: readonly Hand[] = [
  ['Hotel', 'hotel'],
  ['Bistro', 'restaurant'],
  ['Salon', 'salon'],
  ['Trattoria', 'restaurant'],
  ['Inn', 'hotel'],
]

type City = readonly [city: string, country: string, timezone: string, language: string]
const CITIES: readonly City[] = [
  ['Sofia', 'Bulgaria', 'Europe/Sofia', 'Bulgarian'],
  ['Plovdiv', 'Bulgaria', 'Europe/Sofia', 'Bulgarian'],
  ['Berlin', 'Germany', 'Europe/Berlin', 'German'],
  ['Rome', 'Italy', 'Europe/Rome', 'Italian'],
  ['Zurich', 'Switzerland', 'Europe/Zurich', 'German'],
  ['Lisbon', 'Portugal', 'Europe/Lisbon', 'English'],
  ['Vienna', 'Austria', 'Europe/Vienna', 'German'],
  ['Athens', 'Greece', 'Europe/Athens', 'English'],
  ['Prague', 'Czechia', 'Europe/Prague', 'English'],
  ['Valencia', 'Spain', 'Europe/Madrid', 'English'],
]

const FIRST_NAMES = ['Ivana', 'Marco', 'Sofia', 'Tomas', 'Hana', 'Elif', 'Lukas', 'Nia']
const LAST_NAMES = ['Dimitrova', 'Bellini', 'Lang', 'Ferreira', 'Novak', 'Demir', 'Weber']
const PORTAL_NAMES = ['Front desk QR', 'Room cards', 'Receipts', 'Table tents', 'Website']
const GOOGLE_ACCOUNT_EMAILS = [
  'reviews@harbour-group.example',
  'hello@oldtown-group.example',
  'agency@brightside.example',
]

const countFor = (input: FixtureInput): number =>
  input.props === 'real'
    ? Math.max(1, input.realProperties.length)
    : PROPERTY_COUNT[input.props]

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

function buildMembers(input: FixtureInput, propertyCount: number): MemberFixture[] {
  const total = propertyCount <= 1 ? 5 : propertyCount <= 10 ? 9 : 31
  const people: MemberFixture[] = []
  for (let i = 0; i < total; i += 1) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length] ?? 'Alex'
    const last = LAST_NAMES[(i * 3 + Math.floor(i / 8)) % LAST_NAMES.length] ?? 'Smith'
    // Seat 0 is the admin: the viewer for an AccountAdmin, a colleague for a manager.
    // Seat 1 is the viewer when they are a manager.
    const isViewer = input.role === 'aa' ? i === 0 : i === 1
    const name = isViewer ? input.user.name : `${first} ${last}`
    people.push({
      id: `proto-member-${i}`,
      name,
      email: isViewer ? input.user.email : `${slug(first)}.${slug(last)}@example.com`,
      role: i === 0 ? 'AccountAdmin' : i % 4 === 1 ? 'Member' : 'PropertyManager',
      status: i === total - 1 && total > 5 ? 'invited' : 'active',
      isViewer,
    })
  }
  // A manager viewer must be a manager.
  return input.role === 'pm'
    ? people.map((p) => (p.isViewer ? { ...p, role: 'PropertyManager' as const } : p))
    : people
}

type Seed = Readonly<{
  id: string
  name: string
  address: string | null
  timezone: string
}>

function seedFor(
  index: number,
  real: readonly RealPropertyInput[],
): Seed & { isReal: boolean; kind: PropertyKind } {
  const city = CITIES[index % CITIES.length] ?? CITIES[0]!
  const realOne = real[index]
  const hand = HAND_NAMED[index]
  const tail = TAILS[Math.floor(index / 12) % TAILS.length] ?? TAILS[0]!
  const head = [...HEADS, ...HEADS_MORE][index % 12] ?? 'Harbour'
  const name = hand?.[0] ?? `${head} ${tail[0]}`
  const kind = hand?.[1] ?? tail[1]
  return realOne
    ? { ...realOne, isReal: true, kind }
    : {
        id: `proto-prop-${index + 1}`,
        name,
        address: `${((index * 7) % 90) + 3} Main Street, ${city[0]}`,
        timezone: city[2],
        isReal: false,
        kind,
      }
}

function buildProperty(
  index: number,
  real: readonly RealPropertyInput[],
  managerPool: readonly string[],
  accountCount: number,
): PropertyFixture {
  const seed = seedFor(index, real)
  const city = CITIES[index % CITIES.length] ?? CITIES[0]!
  const first = index === 0
  const googleState: GoogleState = first
    ? 'linked'
    : index % 29 === 2
      ? 'not_linked'
      : index % 23 === 7
        ? 'needs_reconnect'
        : 'linked'
  const ai: AiState =
    first || index % 7 === 3 ? 'undecided' : index % 6 === 2 ? 'off' : 'on'
  const look: LookState =
    index % 4 === 0 ? 'draft' : index % 13 === 6 ? 'none' : 'published'
  const language = index % 11 === 5 ? null : city[3]
  const voice =
    first || index % 5 === 1
      ? null
      : { greeting: 'Dear {first name},', signOff: `Warm regards, ${seed.name}` }
  const managerCount = first ? 2 : index % 9 === 4 ? 0 : 1 + (index % 3)
  const managerIds = Array.from(
    { length: managerCount },
    (_, k) => managerPool[(index + k) % managerPool.length],
  ).filter((id): id is string => id !== undefined)
  const live = first ? 3 : index % 8 === 3 ? 0 : 1 + (index % 3)
  const toPublish = first ? 1 : index % 6 === 0 ? 1 : 0
  const custom = !first && index % 10 === 4
  const steps: Record<SetupStepKey, boolean> = {
    details: index % 17 !== 9,
    google: googleState === 'linked',
    language: language !== null,
    voice: voice !== null,
    ai: ai !== 'undecided',
    people: managerIds.length > 0,
    portal: live > 0,
  }
  return {
    id: seed.id,
    name: seed.name,
    isReal: seed.isReal,
    kind: seed.kind,
    city: city[0],
    country: city[1],
    address: seed.address ?? `${city[0]}, ${city[1]}`,
    timezone: seed.timezone,
    google: {
      state: googleState,
      accountId: `proto-google-${index % accountCount}`,
      listingName: googleState === 'not_linked' ? null : seed.name,
      reviewCount: first ? 214 : 40 + ((index * 37) % 400),
    },
    language,
    voice,
    ai,
    aiTools: ai === 'on' ? (index % 4 === 3 ? 2 : 3) : 0,
    managerIds,
    look,
    targets: {
      mode: custom ? 'custom' : 'default',
      privateFeedbackHours: custom
        ? index % 2 === 0
          ? 12
          : 36
        : DEFAULT_PRIVATE_FEEDBACK_HOURS,
      googleReviewsHours: DEFAULT_GOOGLE_REVIEWS_HOURS,
    },
    portals: {
      live,
      toPublish,
      names: PORTAL_NAMES.slice(0, Math.max(1, live + toPublish)),
    },
    steps,
  }
}

function buildGoogleAccounts(
  properties: readonly PropertyFixture[],
  accountCount: number,
): GoogleAccountFixture[] {
  return Array.from({ length: accountCount }, (_, k) => {
    const id = `proto-google-${k}`
    return {
      id,
      email: GOOGLE_ACCOUNT_EMAILS[k] ?? `account${k + 1}@example.com`,
      propertyCount: properties.filter((p) => p.google.accountId === id).length,
    }
  })
}

export function buildSettingsPrototypeData(input: FixtureInput): SettingsPrototypeData {
  const count = countFor(input)
  const accountCount = count <= 1 ? 1 : count <= 10 ? 2 : 3
  const members = buildMembers(input, count)
  const managerPool = members.filter((m) => m.role === 'PropertyManager').map((m) => m.id)
  const allProperties = Array.from({ length: count }, (_, i) =>
    buildProperty(i, input.realProperties, managerPool, accountCount),
  )
  const admin = members.find((m) => m.role === 'AccountAdmin')
  return {
    viewer: { name: input.user.name, email: input.user.email, role: input.role },
    workspace: {
      name: input.organizationName,
      slug: slug(input.organizationName) || 'workspace',
      contactEmail: `hello@${slug(input.organizationName) || 'workspace'}.example`,
      adminName: admin?.isViewer
        ? 'an account admin'
        : (admin?.name ?? 'an account admin'),
      defaults: {
        privateFeedbackHours: DEFAULT_PRIVATE_FEEDBACK_HOURS,
        googleReviewsHours: DEFAULT_GOOGLE_REVIEWS_HOURS,
      },
      aiBudget: { usedPercent: 34, label: '17 of 50 euros used this month' },
    },
    allProperties,
    properties:
      input.role === 'pm' ? allProperties.slice(0, GRANTED_PROPERTIES) : allProperties,
    members,
    googleAccounts: buildGoogleAccounts(allProperties, accountCount),
  }
}

/** Steps a viewer counts: an AccountAdmin-only decision (AI) leaves a manager's total. */
export function setupProgressOf(
  property: PropertyFixture,
  role: PrototypeRole,
): Readonly<{ done: number; total: number; nextStep: SetupStepKey | null }> {
  const order: readonly SetupStepKey[] = [
    'details',
    'google',
    'language',
    'voice',
    'ai',
    'people',
    'portal',
  ]
  const counted = order.filter((step) => role === 'aa' || step !== 'ai')
  const open = counted.filter((step) => !property.steps[step])
  return {
    done: counted.length - open.length,
    total: counted.length,
    nextStep: open[0] ?? null,
  }
}
