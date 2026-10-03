// The two writes of the Property look page, as plain functions: what is sent,
// when nothing is, and what the server then holds. The page's autosave runs
// them (and the coordinator turns a throw into "Not saved" with a retry), so
// they decide nothing about timing.

import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import {
  lookDraftOf,
  lookInputOf,
  lookIsUnchanged,
  lookProblemOf,
  type LookDraft,
} from './property-look-rules'

type SavedProfile = Parameters<typeof lookDraftOf>[0]

export type LookSaveResult =
  | Readonly<{ outcome: 'saved'; saved: LookDraft }>
  | Readonly<{ outcome: 'unchanged'; saved: LookDraft }>
  | Readonly<{ outcome: 'invalid'; reason: string; saved: LookDraft }>

export async function runLookSave(
  input: Readonly<{
    propertyId: string
    saved: LookDraft
    draft: LookDraft
    save: (args: { data: ReturnType<typeof lookInputOf> }) => Promise<SavedProfile>
  }>,
): Promise<LookSaveResult> {
  const { propertyId, saved, draft, save } = input
  if (lookIsUnchanged(saved, draft)) return { outcome: 'unchanged', saved }
  const reason = lookProblemOf(draft)
  if (reason !== null) return { outcome: 'invalid', reason, saved }
  const profile = await save({ data: lookInputOf(propertyId, draft) })
  return { outcome: 'saved', saved: lookDraftOf(profile) }
}

export type LocalesSaveResult = Readonly<{
  outcome: 'saved' | 'unchanged'
  saved: readonly string[]
}>

const sameLocales = (first: readonly string[], second: readonly string[]) =>
  first.length === second.length && first.every((locale, i) => locale === second[i])

export async function runLocalesSave(
  input: Readonly<{
    propertyId: string
    saved: readonly string[]
    draft: readonly OfferedGuestLocale[]
    save: (args: {
      data: { propertyId: string; locales: OfferedGuestLocale[] }
    }) => Promise<Readonly<{ defaultGuestLocales: readonly string[] }>>
  }>,
): Promise<LocalesSaveResult> {
  const { propertyId, saved, draft, save } = input
  if (sameLocales(saved, draft)) return { outcome: 'unchanged', saved }
  const profile = await save({ data: { propertyId, locales: [...draft] } })
  return { outcome: 'saved', saved: profile.defaultGuestLocales }
}
