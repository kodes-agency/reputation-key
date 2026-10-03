// What the Property look page decides without a screen: how a typed colour is
// read, what a draft would write, what is wrong with it, the contrast rows the
// board prints, which portals the look reaches, and what the status line says.
// Pure, so the wording and the rules are pinned by tests.

import { isServerFunctionError } from '#/shared/auth/server-function-error'
import { isFieldForLightText } from '#/shared/domain/portal-field-colour'
import {
  lookFieldOf,
  readLookContrast,
  type ContrastReading,
  type LookBackgroundMode,
  type LookReadout,
} from '#/shared/domain/portal-look-readout'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PortalLanguageSet } from '../portal-languages/portal-languages-rules'

export const WORDMARK_MAX = 24

/** The Property look as the page edits it. */
export type LookDraft = Readonly<{
  accent: string
  backgroundMode: LookBackgroundMode
  /** The manual background; kept while the background is automatic, but unused. */
  field: string
  /** Empty means none. */
  wordmark: string
}>

type LookProfile = Readonly<{
  primaryColor: string
  backgroundColor: string
  backgroundMode: LookBackgroundMode
  wordmark: string | null
}>

/** A colour typed or pasted: `#rrggbb`, `rrggbb` or the short `#rgb`, as `#RRGGBB`; else null. */
export function parseColourInput(text: string): string | null {
  const digits = text.trim().replace(/^#/u, '')
  const full = /^[0-9a-f]{3}$/iu.test(digits)
    ? [...digits].map((digit) => `${digit}${digit}`).join('')
    : digits
  return /^[0-9a-f]{6}$/iu.test(full) ? `#${full.toUpperCase()}` : null
}

export function lookDraftOf(profile: LookProfile): LookDraft {
  return {
    accent: profile.primaryColor.toUpperCase(),
    backgroundMode: profile.backgroundMode,
    field: profile.backgroundColor.toUpperCase(),
    wordmark: profile.wordmark ?? '',
  }
}

/** The input of `savePropertyLook` for a draft. */
export function lookInputOf(propertyId: string, draft: LookDraft) {
  const wordmark = draft.wordmark.trim()
  return {
    propertyId,
    accentColour: draft.accent,
    backgroundMode: draft.backgroundMode,
    ...(draft.backgroundMode === 'manual' ? { backgroundColour: draft.field } : {}),
    wordmark: wordmark === '' ? null : wordmark,
  }
}

/** Whether two drafts would write the same thing. */
export function lookIsUnchanged(saved: LookDraft, draft: LookDraft): boolean {
  return (
    saved.accent === draft.accent &&
    saved.backgroundMode === draft.backgroundMode &&
    (draft.backgroundMode === 'auto' || saved.field === draft.field) &&
    saved.wordmark.trim() === draft.wordmark.trim()
  )
}

/** The readout the draft would show a guest; null while a colour is not complete. */
export function readoutOf(draft: LookDraft): LookReadout | null {
  return readLookContrast({
    accent: draft.accent,
    backgroundMode: draft.backgroundMode,
    backgroundColour: draft.field,
  })
}

/**
 * Why the draft cannot be saved, in words for the manager; null when it can.
 * An accent that is hard to see on its field is not one: the guest page draws
 * the text colour in its place, so the readout says so and the save goes on.
 */
export function lookProblemOf(draft: LookDraft): string | null {
  if (draft.wordmark.trim().length > WORDMARK_MAX) {
    return `The wordmark can be at most ${WORDMARK_MAX} characters`
  }
  const readout = readoutOf(draft)
  if (readout === null) return 'Enter the colours as six hex digits'
  if (!readout.smallText.isReadable) {
    return 'Page text cannot be read on this background'
  }
  return null
}

/**
 * The colour a custom background starts from: the one stored when light text
 * can be read on it, else the field the page paints now. The stored colour of
 * a Property that never chose one is the white of the old three-colour form,
 * which would be refused the moment "Custom" was picked.
 */
export function customFieldOf(draft: LookDraft): string {
  if (isFieldForLightText(draft.field)) return draft.field
  return (
    lookFieldOf({
      accent: draft.accent,
      backgroundMode: 'auto',
      backgroundColour: draft.field,
    }) ?? draft.field
  )
}

/** The server's own sentence for a 4xx refusal; null for a failure a retry could fix. */
export function refusalOf(error: unknown): string | null {
  return isServerFunctionError(error) && error.status >= 400 && error.status < 500
    ? error.message
    : null
}

/** A ratio as the board prints it, rounded down so a failing pair never reads as passing. */
export function ratioText(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`
}

export type ReadoutRow = Readonly<{
  label: string
  ratio: string
  isReadable: boolean
  verdict: 'Readable' | 'Hard to read'
  /** What the page does about a pair that is hard to read; null when it needs nothing said. */
  note: string | null
}>

const rowOf = (
  label: string,
  reading: ContrastReading,
  coveredBy: string | null = null,
): ReadoutRow => ({
  label,
  ratio: ratioText(reading.ratio),
  isReadable: reading.isReadable,
  verdict: reading.isReadable ? 'Readable' : 'Hard to read',
  note: reading.isReadable ? null : coveredBy,
})

/** An accent the field cannot show is drawn as the page's text colour (the guest resolver). */
const ACCENT_COVER = 'guests see it as light text'

export function readoutRows(readout: LookReadout): readonly ReadoutRow[] {
  return [
    rowOf('Button text', readout.buttonText),
    rowOf('Small text on the colour field', readout.smallText),
    rowOf('Accent on the colour field', readout.accentOnField, ACCENT_COVER),
  ]
}

// ── The portals the look reaches ─────────────────────────────────────────────

export type AffectedPortalRow = Readonly<{
  portalId: string
  name: string
  publicationState: 'draft' | 'published' | 'disabled' | 'archived'
  group: Readonly<{ id: string; name: string }> | null
}>

export type AffectedPortals = Readonly<{
  /** Live portals: a published look reaches them only when they are published again. */
  live: readonly AffectedPortalRow[]
  /** Never published: they pick the look up when they first go live. */
  drafts: readonly AffectedPortalRow[]
  /** The list the page shows, live first. */
  listed: readonly AffectedPortalRow[]
}>

/** Archived and switched-off portals show no guest page, so the look does not reach them. */
export function affectedPortals(rows: readonly AffectedPortalRow[]): AffectedPortals {
  const live = rows.filter((row) => row.publicationState === 'published')
  const drafts = rows.filter((row) => row.publicationState === 'draft')
  return { live, drafts, listed: [...live, ...drafts] }
}

export function describeAffected(affected: AffectedPortals): string {
  const parts = [
    affected.live.length > 0 ? `${affected.live.length} live` : null,
    affected.drafts.length > 0 ? `${affected.drafts.length} draft` : null,
  ].filter((part): part is string => part !== null)
  return parts.length === 0 ? 'No portals yet' : parts.join(' · ')
}

// ── The status line ──────────────────────────────────────────────────────────

export type LookSaveState = Readonly<{
  status: 'idle' | 'pending' | 'saving' | 'saved' | 'invalid' | 'error'
  /** Why a refused edit was not written: the page's own rule, or the server's refusal. */
  reason?: string
}>

export type LookStatus = Readonly<{
  text: string
  tone: 'quiet' | 'busy' | 'ok' | 'warn'
  canRetry: boolean
}>

function usersOf(live: number): string {
  if (live === 0) return 'no live portal uses this look yet'
  return live === 1
    ? '1 live portal uses this look'
    : `${live} live portals use this look`
}

export function describeLookStatus(
  state: LookSaveState,
  affected: AffectedPortals,
): LookStatus {
  const users = usersOf(affected.live.length)
  switch (state.status) {
    case 'pending':
    case 'saving':
      return { text: 'Saving…', tone: 'busy', canRetry: false }
    case 'saved':
      return { text: `Saved as a draft · ${users}`, tone: 'ok', canRetry: false }
    case 'invalid':
      return {
        text: `Not saved · ${state.reason ?? 'check the highlighted fields'}`,
        tone: 'warn',
        canRetry: false,
      }
    case 'error':
      // A refusal in words (switched off, not allowed) is not cured by trying again.
      return state.reason === undefined
        ? { text: 'Not saved', tone: 'warn', canRetry: true }
        : { text: `Not saved · ${state.reason}`, tone: 'warn', canRetry: false }
    case 'idle':
      return {
        text: users.charAt(0).toUpperCase() + users.slice(1),
        tone: 'quiet',
        canRetry: false,
      }
  }
}

// ── Default languages ────────────────────────────────────────────────────────

/** The ordered default languages as the language rules read them: the fallback first. */
export function languageSetOf(locales: readonly GuestLocale[]): PortalLanguageSet {
  const [primary = 'en', ...additional] = locales
  return { primary, additional }
}
