// Portal context — the rules behind Review & publish (round 4, slice 31).
//
// Before a manager publishes, the review says three things: what guests will
// see change, whether anything stops the publication or deserves a note, and
// how each language stands. This module decides all three. Pure: no I/O, no
// wording. The reader (`getPortalReview`) feeds it what the Portal already
// knows, and the page chooses the words.
//
// What stops a publication is what the publish use case refuses, so the checks
// read the same facts (`ReviewReadiness`) and the same resolver findings
// (`PublicationBlocker`, `PublicationWarning`); the review cannot offer a
// button the server would then refuse, and cannot refuse one it would accept.

import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PortalLanguageCoverage } from './portal-language-coverage'
import {
  describePageEdit,
  pageEditCarriesWording,
  type PortalPageEditKind,
  type PortalPageEditSubject,
} from './portal-page-edit'
import type {
  PublicationBlocker,
  PublicationTextKey,
  PublicationWarning,
} from './portal-publication-source'

// ── checks ───────────────────────────────────────────────────────

export type ReviewCheckStatus = 'blocked' | 'warning' | 'passed'

export type ReviewCheckCode =
  | 'property_available'
  | 'google_destination'
  | 'responsible_manager'
  | 'public_address'
  | 'primary_text'
  | 'language_packs'
  | 'time_zone'
  | 'copied_text'

/** In the order a manager reads them; within one status a check keeps this order. */
const CHECK_ORDER: readonly ReviewCheckCode[] = [
  'property_available',
  'google_destination',
  'responsible_manager',
  'public_address',
  'primary_text',
  'language_packs',
  'time_zone',
  'copied_text',
]

export type ReviewCheck = Readonly<{
  code: ReviewCheckCode
  status: ReviewCheckStatus
  /** The language a finding is about; null for a check about the whole Portal. */
  locale: GuestLocale | null
  /** The texts a finding names (a missing or copied text); empty for every other check. */
  keys: readonly PublicationTextKey[]
}>

/** Everything the checks read: the publish gates and what the resolver found. */
export type ReviewReadiness = Readonly<{
  propertyActive: boolean
  googleDestinationVerified: boolean
  /** Someone is responsible for the Portal (`responsibilityNeededSince` is empty). */
  hasResponsibleManager: boolean
  /** The Portal has a public address guests can use. */
  hasPublicAddress: boolean
  blockers: readonly PublicationBlocker[]
  warnings: readonly PublicationWarning[]
}>

export type ReviewChecks = Readonly<{
  /** Blocked first, then warnings, then the checks that passed. */
  checks: readonly ReviewCheck[]
  /** True only when nothing is blocked; warnings never stop a publication. */
  canPublish: boolean
  blockedCount: number
  warningCount: number
  passedCount: number
}>

const STATUS_ORDER: Readonly<Record<ReviewCheckStatus, number>> = {
  blocked: 0,
  warning: 1,
  passed: 2,
}

const gate = (code: ReviewCheckCode, ok: boolean): ReviewCheck => ({
  code,
  status: ok ? 'passed' : 'blocked',
  locale: null,
  keys: [],
})

/** One check per language, collecting the texts each language's findings name. */
function perLocale(
  code: ReviewCheckCode,
  status: ReviewCheckStatus,
  findings: ReadonlyArray<Readonly<{ locale: GuestLocale; key?: PublicationTextKey }>>,
): ReviewCheck[] {
  const byLocale = new Map<GuestLocale, PublicationTextKey[]>()
  for (const finding of findings) {
    const keys = byLocale.get(finding.locale) ?? []
    if (finding.key !== undefined) keys.push(finding.key)
    byLocale.set(finding.locale, keys)
  }
  return [...byLocale].map(([locale, keys]) => ({ code, status, locale, keys }))
}

export function evaluateReviewChecks(readiness: ReviewReadiness): ReviewChecks {
  const missingText = readiness.blockers.flatMap((blocker) =>
    blocker.code === 'primary_text_missing'
      ? [{ locale: blocker.locale, key: blocker.key }]
      : [],
  )
  const missingPack = readiness.blockers.flatMap((blocker) =>
    blocker.code === 'language_pack_missing' ? [{ locale: blocker.locale }] : [],
  )
  const badTimeZone = readiness.blockers.some(
    (blocker) => blocker.code === 'time_zone_invalid',
  )
  const copied = readiness.warnings.map((warning) => ({
    locale: warning.locale,
    key: warning.key,
  }))

  const found: ReviewCheck[] = [
    gate('property_available', readiness.propertyActive),
    gate('google_destination', readiness.googleDestinationVerified),
    gate('responsible_manager', readiness.hasResponsibleManager),
    gate('public_address', readiness.hasPublicAddress),
    ...(missingText.length > 0
      ? perLocale('primary_text', 'blocked', missingText)
      : [gate('primary_text', true)]),
    ...(missingPack.length > 0
      ? perLocale('language_packs', 'blocked', missingPack)
      : [gate('language_packs', true)]),
    gate('time_zone', !badTimeZone),
    ...perLocale('copied_text', 'warning', copied),
  ]

  const checks = found
    .map((check, index) => ({ check, index }))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.check.status] - STATUS_ORDER[b.check.status] ||
        CHECK_ORDER.indexOf(a.check.code) - CHECK_ORDER.indexOf(b.check.code) ||
        a.index - b.index,
    )
    .map(({ check }) => check)
  const count = (status: ReviewCheckStatus) =>
    checks.filter((check) => check.status === status).length
  return {
    checks,
    canPublish: count('blocked') === 0,
    blockedCount: count('blocked'),
    warningCount: count('warning'),
    passedCount: count('passed'),
  }
}

// ── what guests will see change ──────────────────────────────────

/** One page-edit ledger row since the newest version was published. */
export type ReviewEditInput = Readonly<{
  kind: PortalPageEditKind
  key: string
  propertyWide: boolean
  /** Null for the system. */
  actorUserId: string | null
  occurredAt: Date
  previousText: string | null
  newText: string | null
  /** How many saves the row stands for. */
  editCount: number
}>

/** One open pending-change fence row. */
export type ReviewPendingInput = Readonly<{
  kind: PortalPageEditKind
  /** Null for a change made before the person was recorded, and for the system. */
  changedBy: string | null
  changedAt: Date
}>

export type ReviewChange =
  | Readonly<{
      type: 'edit'
      kind: PortalPageEditKind
      key: string
      subject: PortalPageEditSubject
      propertyWide: boolean
      actorUserId: string | null
      occurredAt: Date
      previousText: string | null
      newText: string | null
      editCount: number
    }>
  /** The fence says this kind of input moved, and the ledger has no row for it. */
  | Readonly<{
      type: 'unrecorded'
      kind: PortalPageEditKind
      actorUserId: string | null
      occurredAt: Date
    }>
  /** The live version is the earlier design: publishing moves guests to the new one. */
  | Readonly<{ type: 'earlier_design' }>
  /** The live version is pinned to a Google address the Property has since left. */
  | Readonly<{ type: 'google_destination_moved' }>
  /** The draft is not what is live, but no change that can be named explains it. */
  | Readonly<{ type: 'unlisted' }>

export type ReviewChangesInput = Readonly<{
  /** Ledger rows made since the newest version was published, in any order. */
  edits: readonly ReviewEditInput[]
  /** The fence rows still open, in any order. */
  pending: readonly ReviewPendingInput[]
  /** The live version is a schema version 1 or 2 snapshot. */
  liveIsEarlierDesign: boolean
  destinationMoved: boolean
  /** The draft, resolved as publishing resolves it, is not what the live version says. */
  workingCopyDiffers: boolean
}>

type EditGroup = {
  first: ReviewEditInput
  last: ReviewEditInput
  editCount: number
}

/** The tile or heading an edit belongs to; null for edits that belong to no one tile. */
function entityOf(subject: PortalPageEditSubject): string | null {
  switch (subject.area) {
    case 'link':
    case 'link_text':
      return `link:${subject.linkId}`
    case 'category':
      return `category:${subject.categoryId}`
    default:
      return null
  }
}

const entityChange = (subject: PortalPageEditSubject): string | null =>
  subject.area === 'link' || subject.area === 'category' ? subject.change : null

/** Saves of one part, oldest first, become one change: first wording to last wording. */
function foldByPart(edits: readonly ReviewEditInput[]): EditGroup[] {
  const groups = new Map<string, EditGroup>()
  const ordered = edits
    .map((edit, index) => ({ edit, index }))
    .sort(
      (a, b) =>
        a.edit.occurredAt.getTime() - b.edit.occurredAt.getTime() || a.index - b.index,
    )
  for (const { edit } of ordered) {
    const id = `${edit.kind}\u0000${edit.key}`
    const group = groups.get(id)
    if (group === undefined) {
      groups.set(id, { first: edit, last: edit, editCount: edit.editCount })
    } else {
      group.last = edit
      group.editCount += edit.editCount
    }
  }
  return [...groups.values()]
}

/** Wording saved and then put back is no change at all. */
const isPutBack = (group: EditGroup): boolean =>
  pageEditCarriesWording(group.last.kind, group.last.key) &&
  group.first.previousText !== null &&
  group.last.newText !== null &&
  group.first.previousText === group.last.newText

/**
 * Entities that exist only in this draft. A tile added and then removed never
 * reached guests; edits to a tile added in this draft are part of its adding.
 */
function draftOnlyEntities(
  groups: readonly EditGroup[],
): Readonly<{ vanished: ReadonlySet<string>; added: ReadonlySet<string> }> {
  const created = new Set<string>()
  const deleted = new Set<string>()
  for (const group of groups) {
    const subject = describePageEdit(group.last.kind, group.last.key)
    const entity = entityOf(subject)
    if (entity === null) continue
    const change = entityChange(subject)
    if (change === 'created') created.add(entity)
    if (change === 'deleted') deleted.add(entity)
  }
  const vanished = new Set([...created].filter((entity) => deleted.has(entity)))
  const added = new Set([...created].filter((entity) => !deleted.has(entity)))
  return { vanished, added }
}

function listedEdits(groups: readonly EditGroup[]): ReviewChange[] {
  const { vanished, added } = draftOnlyEntities(groups)
  return groups.flatMap((group): ReviewChange[] => {
    const { kind, key } = group.last
    const subject = describePageEdit(kind, key)
    const entity = entityOf(subject)
    if (isPutBack(group)) return []
    if (entity !== null && vanished.has(entity)) return []
    if (entity !== null && added.has(entity) && entityChange(subject) !== 'created') {
      return []
    }
    return [
      {
        type: 'edit',
        kind,
        key,
        subject,
        propertyWide: group.last.propertyWide,
        actorUserId: group.last.actorUserId,
        occurredAt: group.last.occurredAt,
        previousText: group.first.previousText,
        newText: group.last.newText,
        editCount: group.editCount,
      },
    ]
  })
}

/** Fence kinds the ledger says nothing about, once each, with the latest change of the kind. */
function unrecordedChanges(
  pending: readonly ReviewPendingInput[],
  edits: readonly ReviewEditInput[],
): ReviewChange[] {
  const explained = new Set(edits.map((edit) => edit.kind))
  const latest = new Map<PortalPageEditKind, ReviewPendingInput>()
  for (const row of pending) {
    if (explained.has(row.kind)) continue
    const seen = latest.get(row.kind)
    if (seen === undefined || row.changedAt > seen.changedAt) latest.set(row.kind, row)
  }
  return [...latest.values()].map((row) => ({
    type: 'unrecorded',
    kind: row.kind,
    actorUserId: row.changedBy,
    occurredAt: row.changedAt,
  }))
}

const when = (change: ReviewChange): number =>
  change.type === 'edit' || change.type === 'unrecorded' ? change.occurredAt.getTime() : 0

/**
 * The plain list of what guests will see change: why the live page is the
 * earlier design or a stale address first, then each part of the page that was
 * changed, oldest first, each as one change however often it was saved. A part
 * changed and changed back, and a tile added and removed again, are not
 * listed. When the draft differs but nothing nameable is left, one "unlisted"
 * entry says so instead of showing a review that claims nothing changed.
 */
export function buildReviewChanges(input: ReviewChangesInput): readonly ReviewChange[] {
  const leading: ReviewChange[] = [
    ...(input.liveIsEarlierDesign ? [{ type: 'earlier_design' } as const] : []),
    ...(input.destinationMoved ? [{ type: 'google_destination_moved' } as const] : []),
  ]
  const named = [
    ...listedEdits(foldByPart(input.edits)),
    ...unrecordedChanges(input.pending, input.edits),
  ]
    .map((change, index) => ({ change, index }))
    .sort((a, b) => when(a.change) - when(b.change) || a.index - b.index)
    .map(({ change }) => change)
  const changes = [...leading, ...named]
  if (changes.length === 0 && (input.pending.length > 0 || input.workingCopyDiffers)) {
    return [{ type: 'unlisted' }]
  }
  return changes
}

// ── languages ────────────────────────────────────────────────────

export type ReviewLanguageStatus =
  /** Every text is written in this language. */
  | 'complete'
  /** A text is missing, and guests read the fallback language's in its place. */
  | 'copied_from_fallback'
  /** The fallback language itself has a gap: nothing can stand in, so publishing is refused. */
  | 'blocked'

export type ReviewLanguageRow = Readonly<{
  locale: GuestLocale
  isFallback: boolean
  total: number
  present: number
  missingCount: number
  status: ReviewLanguageStatus
  /** Texts that began as an AI draft and have not been written over since. */
  aiDraftCount: number
}>

/**
 * One row per language the Portal offers, from the coverage read: how much is
 * written and what a gap means for guests.
 */
export function reviewLanguageRows(
  coverage: PortalLanguageCoverage,
  aiDraftCounts: Readonly<Partial<Record<GuestLocale, number>>>,
): readonly ReviewLanguageRow[] {
  return coverage.languages.map((row): ReviewLanguageRow => {
    const missingCount = row.missing.length
    const blocked = row.missing.some((text) => text.blocksPublish)
    return {
      locale: row.locale,
      isFallback: row.isFallback,
      total: row.total,
      present: row.present,
      missingCount,
      status: blocked
        ? 'blocked'
        : missingCount > 0
          ? 'copied_from_fallback'
          : 'complete',
      aiDraftCount: aiDraftCounts[row.locale] ?? 0,
    }
  })
}
