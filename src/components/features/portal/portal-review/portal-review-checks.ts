// The checks of Review & publish as sentences. The review read says which gates
// stand in the way (a blocked check), which findings only deserve a note (a
// warning) and which passed; this decides the words and where each is fixed.
// Pure: the page draws the pieces. A blocked check is one the server would
// refuse the publication on, so every blocked line says what to do about it; a
// warning says what guests would read instead and that publishing can go on.

import type {
  MissingPortalText,
  ReviewCheck,
} from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type {
  PortalResponsibleManagerState,
  ResponsibleManagerMember,
} from '../portal-detail/portal-detail-types'
import {
  englishLanguage,
  joinPhrases,
  nativeLanguage,
  plain,
  quoted,
  type Phrase,
} from '../portal-history/portal-history-phrase'
import {
  PORTAL_EDITOR_SECTION_LABELS,
  type PortalEditorSection,
} from '../portal-editor/portal-editor-sections'

/** Where a blocked check is put right: a section of the Page tab, or the Share tab. */
export type ReviewFixTarget =
  Readonly<{ tab: 'page'; section: PortalEditorSection }> | Readonly<{ tab: 'share' }>

export type ReviewCheckLine = Readonly<{
  id: string
  status: ReviewCheck['status']
  title: Phrase
  detail: Phrase | null
  /** Said after a warning: it does not stop the publication. */
  note: string | null
  fix: ReviewFixTarget | null
}>

export type ReviewCheckContext = Readonly<{
  /** The texts the check's language is missing, to name a link label by its wording. */
  missing: ReadonlyArray<MissingPortalText>
  /** The language that stands in for a missing text. */
  fallbackLocale: GuestLocale
}>

const CAN_PUBLISH_NOTE = 'You can publish without it.'

const isLinkKey = (key: string): boolean => key.startsWith('link:')

const linkLabelOf = (
  key: string,
  missing: ReadonlyArray<MissingPortalText>,
): string | null => missing.find((text) => text.key === key)?.linkLabel ?? null

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

/** "1 label missing", "2 texts missing": labels only when every text is a link label. */
function countMissing(keys: readonly string[]): string {
  return keys.every(isLinkKey)
    ? `${plural(keys.length, 'label', 'labels')} missing`
    : `${plural(keys.length, 'text', 'texts')} missing`
}

/** How many texts are named one by one before the rest are only counted. */
const NAMED_TEXTS = 3

type Wording = 'read' | 'needed'

/** One missing text in words: what a guest reads ("‘Spa’") or what publishing needs ("the label for ‘Spa’"). */
function textPhrase(key: string, wording: Wording, context: ReviewCheckContext): Phrase {
  if (key === 'title') return [plain('the title')]
  if (key === 'shortDescription') return [plain('the description')]
  if (key === 'heroAlt') return [plain('the photo description')]
  const label = linkLabelOf(key, context.missing)
  if (label === null) return [plain('a link label')]
  return wording === 'read'
    ? [quoted(label, context.fallbackLocale)]
    : [plain('the label for '), quoted(label, context.fallbackLocale)]
}

/** The texts a finding names, one by one, or counted when there are many. */
function textsPhrase(
  keys: readonly string[],
  wording: Wording,
  context: ReviewCheckContext,
): Phrase {
  if (keys.length > NAMED_TEXTS) {
    return [
      plain(keys.every(isLinkKey) ? `${keys.length} labels` : `${keys.length} texts`),
    ]
  }
  return joinPhrases(keys.map((key) => textPhrase(key, wording, context)))
}

/** The section where a missing text is written. */
const sectionOfKeys = (keys: readonly string[]): PortalEditorSection =>
  keys.every(isLinkKey) ? 'linktree' : 'welcome'

const languageTitle = (locale: GuestLocale | null, rest: string): Phrase =>
  locale === null ? [plain(rest)] : [nativeLanguage(locale), plain(` · ${rest}`)]

const PASSED_TITLE: Readonly<Record<ReviewCheck['code'], string>> = {
  property_available: 'The property is active',
  google_destination: 'Google link verified',
  responsible_manager: 'A manager is responsible',
  public_address: 'The address works',
  primary_text: 'Every required text is written',
  language_packs: 'Every language is ready',
  time_zone: 'The property’s time zone is valid',
  copied_text: 'Every text is written in every language',
}

type Finding = Readonly<{
  title: Phrase
  detail: Phrase | null
  fix: ReviewFixTarget | null
}>

const finding = (
  title: string,
  detail: string | null,
  fix: ReviewFixTarget | null = null,
): Finding => ({
  title: [plain(title)],
  detail: detail === null ? null : [plain(detail)],
  fix,
})

function blockedFinding(check: ReviewCheck, context: ReviewCheckContext): Finding {
  const { locale, keys } = check
  switch (check.code) {
    case 'property_available':
      return finding(
        'The property is unavailable',
        'Publishing waits until the property is active again.',
      )
    case 'google_destination':
      return finding(
        'No verified Google link',
        'Guests cannot continue to Google until the property’s Google link is connected and refreshed.',
      )
    case 'responsible_manager':
      return finding(
        'No one is responsible for this portal',
        'Assign a responsible manager so updates and feedback have an owner.',
        { tab: 'page', section: 'responsible' },
      )
    case 'public_address':
      return finding(
        'No working code',
        'Make a code on the Share tab so guests have an address to open.',
        { tab: 'share' },
      )
    case 'primary_text':
      return {
        title: languageTitle(locale, countMissing(keys) + '.'),
        detail: [
          plain('Publishing needs '),
          ...textsPhrase(keys, 'needed', context),
          plain(` in ${locale === null ? 'this language' : englishLanguage(locale)}.`),
        ],
        fix: { tab: 'page', section: sectionOfKeys(keys) },
      }
    case 'language_packs':
      return {
        title:
          locale === null
            ? [plain('A language has no guest wording yet')]
            : [nativeLanguage(locale), plain(' has no guest wording yet')],
        detail: [plain('Remove it from the portal’s languages to publish.')],
        fix: { tab: 'page', section: 'languages' },
      }
    case 'time_zone':
      return finding(
        'The property’s time zone is not valid',
        'Set the property’s time zone in its settings, then publish.',
      )
    case 'copied_text':
      return warningFinding(check, context)
  }
}

function warningFinding(check: ReviewCheck, context: ReviewCheckContext): Finding {
  const { locale, keys } = check
  const guests = locale === null ? 'Guests' : `${englishLanguage(locale)} guests`
  return {
    title: languageTitle(locale, countMissing(keys) + '.'),
    detail: [
      plain(`${guests} see `),
      ...textsPhrase(keys, 'read', context),
      plain(` in ${englishLanguage(context.fallbackLocale)}.`),
    ],
    // The Languages section lists each gap and links to where it is written.
    fix: { tab: 'page', section: 'languages' },
  }
}

/** One check as a sentence, with where to fix it and, for a warning, that publishing can go on. */
export function describeReviewCheck(
  check: ReviewCheck,
  context: ReviewCheckContext,
): ReviewCheckLine {
  const id = `${check.code}:${check.locale ?? 'portal'}`
  if (check.status === 'passed') {
    return {
      id,
      status: 'passed',
      title: [plain(PASSED_TITLE[check.code])],
      detail: null,
      note: null,
      fix: null,
    }
  }
  const found =
    check.status === 'warning'
      ? warningFinding(check, context)
      : blockedFinding(check, context)
  return {
    id,
    status: check.status,
    ...found,
    note: check.status === 'warning' ? CAN_PUBLISH_NOTE : null,
  }
}

/** The names of the first two checks, lower-cased except for a name that starts with one. */
const lowerFirst = (text: string): string =>
  text.startsWith('Google') ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`

const plainText = (phrase: Phrase): string => phrase.map((piece) => piece.text).join('')

/**
 * "6 checks passed · Google link verified, the address works and more": how many
 * gates passed and a taste of which; null when none did.
 */
export function summarizePassedChecks(passed: readonly ReviewCheckLine[]): string | null {
  if (passed.length === 0) return null
  const named = passed.slice(0, 2).map((line) => lowerFirst(plainText(line.title)))
  const list = named.join(passed.length > 2 ? ', ' : ' and ')
  const tail = passed.length > 2 ? ' and more' : ''
  return `${plural(passed.length, 'check', 'checks')} passed · ${list}${tail}`
}

export type FixPerson = Readonly<{ userId: string; name: string }>

/** How many people are named before the rest are only counted. */
const NAMED_PEOPLE = 3

/**
 * "you or Georgi Ivanov": who can put a check right. The viewer comes first and
 * is "you"; a long list names the first few and counts the rest. Null when no
 * one is known.
 */
export function describeWhoCanFix(
  viewerId: string,
  people: readonly FixPerson[],
): string | null {
  if (people.length === 0) return null
  const viewer = people.filter((person) => person.userId === viewerId)
  const others = people.filter((person) => person.userId !== viewerId)
  const names = [...viewer.map(() => 'you'), ...others.map((person) => person.name)]
  if (names.length <= NAMED_PEOPLE) {
    const last = names[names.length - 1]
    return names.length === 1
      ? (last ?? null)
      : `${names.slice(0, -1).join(', ')} or ${last}`
  }
  return `${names.slice(0, NAMED_PEOPLE).join(', ')} or ${names.length - NAMED_PEOPLE} more`
}

/** The link that opens a fix: its words, and the route search that gets there. */
export function describeFixLink(fix: ReviewFixTarget): Readonly<{
  label: string
  search: ReviewFixTarget
}> {
  return {
    label: `Open ${fix.tab === 'share' ? 'Share' : PORTAL_EDITOR_SECTION_LABELS[fix.section]}`,
    search: fix,
  }
}

/**
 * The people a manager can turn to about a Portal: its responsible managers, or
 * when no one is yet, the managers who could be made responsible. A person the
 * member list cannot name is left out rather than shown as an identifier.
 */
export function resolveFixPeople(
  state: Pick<PortalResponsibleManagerState, 'assignments' | 'eligibleManagers'>,
  members: readonly Pick<ResponsibleManagerMember, 'userId' | 'name'>[],
): readonly FixPerson[] {
  const ids =
    state.assignments.length > 0
      ? state.assignments.map((assignment) => assignment.userId)
      : state.eligibleManagers.map((manager) => manager.userId)
  return ids.flatMap((userId) => {
    const member = members.find((candidate) => candidate.userId === userId)
    return member === undefined ? [] : [{ userId, name: member.name }]
  })
}
