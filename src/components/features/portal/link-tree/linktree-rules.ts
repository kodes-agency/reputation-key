// Portal editor — the pure rules behind the Linktree section: the cap fact, which
// languages a tile still lacks, what the approval line says, how a keyboard move
// re-orders a group, and how the text and title forms map to what is saved.
//
// Pure and colocated with the section so the words and the ordering are pinned
// by tests, not by JSX. Links are listed in guest order (see
// `portal-linktree-view.ts`); while older categories still exist, a move stays
// inside its category: the server orders links within one.

import { generateKeyBetween } from 'fractional-indexing'
import {
  GUEST_LOCALE_METADATA,
  OFFERED_GUEST_LOCALES,
  type GuestLocale,
  type OfferedGuestLocale,
} from '#/shared/domain/guest-locale'
import type {
  PortalLinktreeDestination,
  PortalLinktreeLink,
} from '#/contexts/portal/application/public-api'

const isOffered = (locale: GuestLocale): locale is OfferedGuestLocale =>
  (OFFERED_GUEST_LOCALES as ReadonlyArray<GuestLocale>).includes(locale)

/**
 * The languages a manager can write text in today (those with a reviewed
 * language pack), in the order the Portal lists them: the primary one first.
 */
export function offeredLocales(
  locales: ReadonlyArray<GuestLocale>,
): ReadonlyArray<OfferedGuestLocale> {
  return locales.filter(isOffered)
}

export type LinkCapFact = Readonly<{ text: string; isFull: boolean }>

export function describeLinkCap(count: number, max: number): LinkCapFact {
  return { text: `${count} of ${max} tiles in use`, isFull: count >= max }
}

/** What a tile prints as its name: the primary language, else the first text it has. */
export function linkLabelFor(
  link: PortalLinktreeLink,
  primaryLocale: GuestLocale,
): Readonly<{ label: string; line: string | null }> {
  const text =
    link.texts.find((entry) => entry.locale === primaryLocale) ?? link.texts[0] ?? null
  return { label: text?.label ?? '', line: text?.line ?? null }
}

export type LinkLocaleChip = Readonly<{
  locale: GuestLocale
  /** The two-letter chip: EN, БГ. */
  chip: string
  name: string
  isMissing: boolean
}>

/** One chip per language the Portal offers; a language with no label is missing. */
export function linkLocaleChips(
  link: PortalLinktreeLink,
  locales: ReadonlyArray<GuestLocale>,
): ReadonlyArray<LinkLocaleChip> {
  return locales.map((locale) => {
    const text = link.texts.find((entry) => entry.locale === locale)
    const { chipLabel, englishName } = GUEST_LOCALE_METADATA[locale]
    return {
      locale,
      chip: chipLabel,
      name: englishName,
      isMissing: text === undefined || text.label.trim() === '',
    }
  })
}

/**
 * The one chip a tile shows at phone width, where the full list of languages
 * does not fit: "DE missing", "ES, DE missing", or a count from three up. Null
 * when nothing is missing, and for a Portal with one language, which has no
 * list to abbreviate.
 */
export function describeMissingLanguages(
  chips: ReadonlyArray<LinkLocaleChip>,
): string | null {
  if (chips.length < 2) return null
  const missing = chips.filter((chip) => chip.isMissing)
  if (missing.length === 0) return null
  if (missing.length > MAX_NAMED_MISSING) return `${missing.length} missing`
  return `${missing.map((chip) => chip.chip).join(', ')} missing`
}

const MAX_NAMED_MISSING = 2

export type LinkApprovalFact = Readonly<{ tone: 'ok' | 'warn'; text: string }>

/** The one line under a tile's address: who vouched for it, or why guests cannot see it yet. */
export function describeLinkApproval(
  destination: PortalLinktreeDestination,
  names: ReadonlyMap<string, string>,
): LinkApprovalFact {
  switch (destination.state) {
    case 'approved': {
      if (
        destination.sourceType === 'recognized' ||
        destination.sourceType === 'provider'
      ) {
        return { tone: 'ok', text: 'Recognised service · approved automatically' }
      }
      const name =
        destination.approvedByUserId === null
          ? undefined
          : names.get(destination.approvedByUserId)
      return { tone: 'ok', text: name === undefined ? 'Approved' : `Approved · ${name}` }
    }
    case 'pending':
      return {
        tone: 'warn',
        text: 'Waiting for approval · guests will not see this link until an account admin approves it',
      }
    case 'disabled':
      return {
        tone: 'warn',
        text: 'Not approved · an account admin turned this address off',
      }
    case 'quarantined':
      return {
        tone: 'warn',
        text: 'Held back · this address did not pass a safety check',
      }
    case 'unclassified':
      return {
        tone: 'warn',
        text: 'Not checked yet · guests will not see this link until its address is checked',
      }
  }
}

export type LinkMoveDirection = 'up' | 'down'

/** Which control asked for a move: a chevron button, or the handle's arrow keys. */
export type LinkMoveControl = LinkMoveDirection | 'handle'

/**
 * The move an arrow key on a tile's handle asks for. The handle is the
 * keyboard stand-in for dragging (drag and drop is not offered): Up and Down
 * move the tile one place, and no other key is taken from the handle.
 */
export function moveDirectionForKey(key: string): LinkMoveDirection | null {
  if (key === 'ArrowUp') return 'up'
  if (key === 'ArrowDown') return 'down'
  return null
}

export type LinkOrderPlan = Readonly<{
  categoryId: string
  /** The group's links in their new order, each with its new sort key. */
  items: ReadonlyArray<Readonly<{ id: string; sortKey: string }>>
}>

/**
 * The order to save after moving `linkId` one place, or null when it cannot
 * move: it is at that end of the list, or its neighbour sits in another (older)
 * category, which a single save cannot reorder across. The whole group's keys
 * are rewritten as one ascending chain, so the saved order is exactly the one
 * shown whatever the old keys were.
 */
export function planLinkMove(
  links: ReadonlyArray<PortalLinktreeLink>,
  linkId: string,
  direction: LinkMoveDirection,
): LinkOrderPlan | null {
  const index = links.findIndex((link) => link.id === linkId)
  const neighbour = links[direction === 'up' ? index - 1 : index + 1]
  const moving = links[index]
  if (moving === undefined || neighbour === undefined) return null
  if (neighbour.categoryId !== moving.categoryId) return null

  const group = links.filter((link) => link.categoryId === moving.categoryId)
  const from = group.findIndex((link) => link.id === linkId)
  const to = direction === 'up' ? from - 1 : from + 1
  const reordered = [...group]
  reordered.splice(from, 1)
  reordered.splice(to, 0, moving)

  const items: Array<{ id: string; sortKey: string }> = []
  for (const link of reordered) {
    const previous = items[items.length - 1]?.sortKey ?? null
    items.push({ id: link.id, sortKey: generateKeyBetween(previous, null) })
  }
  return { categoryId: moving.categoryId, items }
}

/** The list after a plan: one group re-ordered in place, the rest untouched. */
export function applyLinkOrder(
  links: ReadonlyArray<PortalLinktreeLink>,
  plan: LinkOrderPlan,
): ReadonlyArray<PortalLinktreeLink> {
  const keyOf = new Map(plan.items.map((item) => [item.id, item.sortKey]))
  const byId = new Map(links.map((link) => [link.id, link]))
  const ordered = plan.items.flatMap((item) => {
    const link = byId.get(item.id)
    return link === undefined
      ? []
      : [{ ...link, sortKey: keyOf.get(item.id) ?? link.sortKey }]
  })
  let next = 0
  return links.map((link) => {
    if (link.categoryId !== plan.categoryId) return link
    const replacement = ordered[next]
    next += 1
    return replacement ?? link
  })
}

// ── The text form ─────────────────────────────────────────────────

export type LinkTextsFormValues = Readonly<{
  texts: ReadonlyArray<
    Readonly<{ locale: OfferedGuestLocale; label: string; line: string }>
  >
}>

/** One entry per offered language, empty where nothing is saved. */
export function textsFormValues(
  link: PortalLinktreeLink,
  locales: ReadonlyArray<OfferedGuestLocale>,
): LinkTextsFormValues {
  return {
    texts: locales.map((locale) => {
      const text = link.texts.find((entry) => entry.locale === locale)
      return { locale, label: text?.label ?? '', line: text?.line ?? '' }
    }),
  }
}

/** Languages whose label must stay filled: the primary, and any that already has a text. */
export function requiredTextLocales(
  link: PortalLinktreeLink,
  primaryLocale: GuestLocale,
): ReadonlyArray<GuestLocale> {
  const saved = link.texts.filter((text) => text.label.trim() !== '')
  return [primaryLocale, ...saved.map((text) => text.locale)].filter(
    (locale, index, all) => all.indexOf(locale) === index,
  )
}

/** A line typed where there is no label is never written: say so rather than drop it quietly. */
export function describeUnsavedLine(
  text: Readonly<{ label: string; line: string }>,
): string | null {
  return text.label.trim() === '' && text.line.trim() !== ''
    ? 'Add a label first: a line is only saved together with its label.'
    : null
}

/** What to save: only languages that have a label, and no line as null. */
export function toLinkTextsInput(linkId: string, values: LinkTextsFormValues) {
  return {
    linkId,
    texts: values.texts
      .filter((text) => text.label.trim() !== '')
      .map((text) => ({
        locale: text.locale,
        label: text.label.trim(),
        line: text.line.trim() === '' ? null : text.line.trim(),
      })),
  }
}

// ── The title form ────────────────────────────────────────────────

export type LinktreeTitlesFormValues = Readonly<{
  titles: ReadonlyArray<Readonly<{ locale: OfferedGuestLocale; title: string }>>
}>

export function titlesFormValues(
  titles: Readonly<Partial<Record<GuestLocale, string>>>,
  locales: ReadonlyArray<OfferedGuestLocale>,
): LinktreeTitlesFormValues {
  return { titles: locales.map((locale) => ({ locale, title: titles[locale] ?? '' })) }
}

/** An empty title is sent as null: the language goes back to the default wording. */
export function toLinktreeTitlesInput(
  portalId: string,
  values: LinktreeTitlesFormValues,
) {
  return {
    portalId,
    titles: values.titles.map((entry) => ({
      locale: entry.locale,
      title: entry.title.trim() === '' ? null : entry.title.trim(),
    })),
  }
}
