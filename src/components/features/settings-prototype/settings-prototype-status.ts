// PROTOTYPE — delete after the decision. The status line under each rail row
// ("Linked, 214 reviews", "Voice not set") and its tone. In the real product these
// are the ~14 summarisers the brief warns about; here they are one switch over the
// fixtures, which is enough to feel what the rail says at a glance.
import { setupProgressOf } from './settings-prototype-fixtures'
import type {
  PropertyFixture,
  RowTone,
  SectionKey,
  SettingsPrototypeData,
  SettingsShape,
  SetupStepKey,
} from './settings-prototype-types'

export type RowStatus = Readonly<{ text: string; tone: RowTone }>

const ok = (text: string): RowStatus => ({ text, tone: 'ok' })
const needs = (text: string): RowStatus => ({ text, tone: 'needs' })
const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`

/** The row a setup step is finished on. */
export const SECTION_OF_STEP: Readonly<Record<SetupStepKey, SectionKey>> = {
  details: 'details',
  google: 'google',
  language: 'replies',
  voice: 'replies',
  ai: 'ai',
  people: 'people',
  portal: 'portals',
}

type Input = Readonly<{
  key: SectionKey
  property: PropertyFixture | null
  shape: SettingsShape
  data: SettingsPrototypeData
}>

function propertyStatus(
  key: SectionKey,
  p: PropertyFixture,
  input: Input,
): RowStatus | null {
  const { shape, data } = input
  switch (key) {
    case 'details':
      return p.steps.details ? ok(`${p.city}, ${p.country}`) : needs('Not confirmed')
    case 'google':
      if (p.google.state === 'not_linked') return needs('Not linked')
      if (p.google.state === 'needs_reconnect') return needs('Needs reconnect')
      return ok(`Linked, ${p.google.reviewCount} reviews`)
    case 'replies':
      if (p.language === null) return needs('Language not set')
      return p.voice === null ? needs('Voice not set') : ok(`${p.language}, voice set`)
    case 'ai':
      if (p.ai === 'undecided') return needs('Not decided yet')
      return ok(p.ai === 'on' ? `On, ${p.aiTools} of 3 tools` : 'Off')
    case 'people':
      return p.managerIds.length === 0
        ? needs('No manager yet')
        : ok(plural(p.managerIds.length, 'manager', 'managers'))
    case 'look':
      if (p.look === 'draft') return { text: 'Draft changes', tone: 'draft' }
      return p.look === 'none' ? needs('Not started') : ok('Published')
    case 'targets':
      if (shape.tier === 'single') {
        return ok(
          `${p.targets.privateFeedbackHours} h / ${p.targets.googleReviewsHours} h`,
        )
      }
      return ok(
        p.targets.mode === 'default'
          ? 'Follows default'
          : `Custom, ${p.targets.privateFeedbackHours} h`,
      )
    case 'portals': {
      if (p.portals.live === 0) return needs('None live')
      const tail = p.portals.toPublish > 0 ? `, ${p.portals.toPublish} to publish` : ''
      return {
        text: `${p.portals.live} live${tail}`,
        tone: p.portals.toPublish > 0 ? 'draft' : 'ok',
      }
    }
    case 'notifications':
      return ok(shape.tier === 'single' ? 'Email and in-app' : 'My defaults')
    default:
      return workspaceStatus(key, data)
  }
}

function workspaceStatus(key: SectionKey, data: SettingsPrototypeData): RowStatus | null {
  switch (key) {
    case 'team':
      return ok(plural(data.members.length, 'person', 'people'))
    case 'workspace':
      return ok(data.workspace.name)
    case 'google-accounts':
      return ok(plural(data.googleAccounts.length, 'account', 'accounts'))
    case 'profile':
      return ok(data.viewer.name)
    case 'notifications':
      return ok('My defaults')
    case 'security':
      return ok('Password set')
    default:
      return null
  }
}

/** How many properties still have a setup step to finish, from this viewer's count. */
export function propertiesNeedingSetup(
  data: SettingsPrototypeData,
): readonly PropertyFixture[] {
  return data.properties.filter(
    (p) => setupProgressOf(p, data.viewer.role).nextStep !== null,
  )
}

function allScopeStatus(key: SectionKey, data: SettingsPrototypeData): RowStatus | null {
  if (key === 'overview') {
    const n = propertiesNeedingSetup(data).length
    return n === 0 ? ok('All set up') : needs(`${n} need setup`)
  }
  if (key === 'default-targets') {
    const custom = data.properties.filter((p) => p.targets.mode === 'custom').length
    return ok(custom === 0 ? 'All follow it' : `${custom} custom`)
  }
  return null
}

/** The status of one row. A locked row keeps its value but reads as locked. */
export function statusFor(input: Input & Readonly<{ locked: boolean }>): RowStatus {
  const { key, property, locked, data } = input
  const status =
    (property === null
      ? (allScopeStatus(key, data) ?? workspaceStatus(key, data))
      : propertyStatus(key, property, input)) ?? ok('')
  return locked ? { text: status.text, tone: 'locked' } : status
}
