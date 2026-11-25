// Portal command store — writes to `portal_link_texts` and the Portal's
// language set, shared by the link commands (create, update: the primary-language
// text) and the Linktree commands (per-language texts). A link's wording lives
// here and only here: the legacy `portal_links.label` column is never written.
//
// Every function runs inside a command transaction that already holds the
// Portal fence (ADR 0060), so a locale read here cannot change before commit.

import { and, eq, inArray, sql } from 'drizzle-orm'
import { portalLinkTexts, portals } from '#/shared/db/schema'
import { parseGuestLocale, type GuestLocale } from '#/shared/domain/guest-locale'
import type { Tx } from '#/shared/outbox/commit'
import type { PortalLinkTextWrite } from '../publication/portal-command-store-port.server'
import { portalError } from '../domain/errors'

export type PortalLinkTextScope = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  linkId: string
}>

export type PortalLocales = Readonly<{
  primary: GuestLocale
  /** Primary first, then the additional locales, without repeats. */
  offered: readonly GuestLocale[]
}>

/** Matches exactly one Portal row inside its Organization and Property. */
export const portalScopeWhere = (scope: Omit<PortalLinkTextScope, 'linkId'>) =>
  and(
    eq(portals.organizationId, scope.organizationId),
    eq(portals.propertyId, scope.propertyId),
    eq(portals.id, scope.portalId),
  )

/** What this Portal offers guests today; a corrupt stored locale is an error, never English. */
export async function readPortalLocales(
  tx: Tx,
  scope: Omit<PortalLinkTextScope, 'linkId'>,
): Promise<PortalLocales> {
  const [row] = await tx
    .select({
      primary: portals.primaryGuestLocale,
      additional: portals.additionalGuestLocales,
    })
    .from(portals)
    .where(portalScopeWhere(scope))
    .limit(1)
  if (!row) throw portalError('revision_conflict', 'Portal changed during command')
  const primary = parseGuestLocale(row.primary)
  const additional = Array.isArray(row.additional)
    ? row.additional.map((value) => parseGuestLocale(value))
    : null
  if (!primary || !additional || additional.some((locale) => locale === null)) {
    throw new Error('Portal has a guest locale outside the catalogue')
  }
  const offered = [primary, ...(additional as GuestLocale[])].filter(
    (locale, index, all) => all.indexOf(locale) === index,
  )
  return { primary, offered }
}

export function assertLocalesOffered(
  locales: PortalLocales,
  requested: readonly GuestLocale[],
): void {
  if (new Set(requested).size !== requested.length) {
    throw portalError('locale_not_offered', 'A language was given more than once')
  }
  for (const locale of requested) {
    if (!locales.offered.includes(locale)) {
      throw portalError('locale_not_offered', 'This Portal does not offer that language')
    }
  }
}

type Writer = Readonly<{ actorUserId: string; at: Date }>

/**
 * Upsert whole texts (label, line, provenance). A row that already holds the
 * same values is left alone. Returns the languages that actually changed, with
 * the version each now has, so the caller records pending changes for those only.
 */
export async function upsertLinkTexts(
  tx: Tx,
  scope: PortalLinkTextScope,
  writer: Writer,
  texts: readonly PortalLinkTextWrite[],
): Promise<ReadonlyArray<Readonly<{ locale: GuestLocale; version: number }>>> {
  if (texts.length === 0) return []
  const rows = await tx
    .insert(portalLinkTexts)
    .values(
      texts.map((text) => ({
        ...scope,
        locale: text.locale,
        label: text.label,
        line: text.line,
        provenance: text.provenance,
        version: 1,
        updatedBy: writer.actorUserId,
        createdAt: writer.at,
        updatedAt: writer.at,
      })),
    )
    .onConflictDoUpdate({
      target: [
        portalLinkTexts.organizationId,
        portalLinkTexts.linkId,
        portalLinkTexts.locale,
      ],
      set: {
        label: sql`excluded.label`,
        line: sql`excluded.line`,
        provenance: sql`excluded.provenance`,
        version: sql`${portalLinkTexts.version} + 1`,
        updatedBy: writer.actorUserId,
        updatedAt: writer.at,
      },
      setWhere: sql`(${portalLinkTexts.label}, ${portalLinkTexts.line}, ${portalLinkTexts.provenance}) IS DISTINCT FROM (excluded.label, excluded.line, excluded.provenance)`,
    })
    .returning({ locale: portalLinkTexts.locale, version: portalLinkTexts.version })
  return rows.flatMap((row) => {
    const locale = parseGuestLocale(row.locale)
    return locale ? [{ locale, version: row.version }] : []
  })
}

/**
 * Write the primary-language text of a link from a label alone (a link created
 * or renamed through the link commands): the line, if any, is kept, and the
 * text becomes manager-written.
 */
export async function syncPrimaryLinkText(
  tx: Tx,
  scope: PortalLinkTextScope,
  writer: Writer,
  input: Readonly<{ locale: GuestLocale; label: string }>,
): Promise<void> {
  await tx
    .insert(portalLinkTexts)
    .values({
      ...scope,
      locale: input.locale,
      label: input.label,
      line: null,
      provenance: null,
      version: 1,
      updatedBy: writer.actorUserId,
      createdAt: writer.at,
      updatedAt: writer.at,
    })
    .onConflictDoUpdate({
      target: [
        portalLinkTexts.organizationId,
        portalLinkTexts.linkId,
        portalLinkTexts.locale,
      ],
      set: {
        label: sql`excluded.label`,
        provenance: sql`NULL`,
        version: sql`${portalLinkTexts.version} + 1`,
        updatedBy: writer.actorUserId,
        updatedAt: writer.at,
      },
      setWhere: sql`${portalLinkTexts.label} IS DISTINCT FROM excluded.label`,
    })
}

/**
 * What a link says in the Portal's primary language: its text there, else null.
 * `primary` is the Portal's primary language, or the one it had.
 */
export async function readPrimaryLinkLabel(
  tx: Tx,
  scope: PortalLinkTextScope,
  primary: GuestLocale,
): Promise<string | null> {
  const [text] = await tx
    .select({ label: portalLinkTexts.label })
    .from(portalLinkTexts)
    .where(
      and(
        eq(portalLinkTexts.organizationId, scope.organizationId),
        eq(portalLinkTexts.linkId, scope.linkId),
        eq(portalLinkTexts.locale, primary),
      ),
    )
    .limit(1)
  return text?.label ?? null
}

/**
 * A Portal's primary language just changed: no link may be left unnamed in the
 * language that now has to be complete before publishing. Each link keeps its
 * wording in the old primary language, and the new primary language starts from
 * it where it has no text of its own. A link with no wording at all is left as
 * it is. Runs inside the Portal update transaction.
 */
export async function reconcileLinkTextsToPrimary(
  tx: Tx,
  scope: Omit<PortalLinkTextScope, 'linkId'>,
  writer: Writer,
  primary: GuestLocale,
  previousPrimary: GuestLocale,
): Promise<void> {
  const texts = await tx
    .select({
      linkId: portalLinkTexts.linkId,
      locale: portalLinkTexts.locale,
      label: portalLinkTexts.label,
    })
    .from(portalLinkTexts)
    .where(
      and(
        eq(portalLinkTexts.organizationId, scope.organizationId),
        eq(portalLinkTexts.portalId, scope.portalId),
        inArray(portalLinkTexts.locale, [primary, previousPrimary]),
      ),
    )
  const hasText = (linkId: string, locale: GuestLocale) =>
    texts.some((text) => text.linkId === linkId && text.locale === locale)
  for (const link of texts.filter((text) => text.locale === previousPrimary)) {
    if (!hasText(link.linkId, primary)) {
      await syncPrimaryLinkText(tx, { ...scope, linkId: link.linkId }, writer, {
        locale: primary,
        label: link.label,
      })
    }
  }
}
