// Portal command store — writes to `portal_link_texts` and the Portal's
// language set, shared by the link commands (create, update: the dual write of
// the primary-language label) and the Linktree commands (per-language texts).
//
// Every function runs inside a command transaction that already holds the
// Portal fence (ADR 0060), so a locale read here cannot change before commit.

import { and, eq, sql } from 'drizzle-orm'
import { portalLinkTexts, portals } from '#/shared/db/schema'
import { parseGuestLocale, type GuestLocale } from '#/shared/domain/guest-locale'
import type { Tx } from '#/shared/outbox/commit'
import type { PortalLinkTextWrite } from '../application/ports/portal-command-store.port'
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
    .where(
      and(
        eq(portals.organizationId, scope.organizationId),
        eq(portals.propertyId, scope.propertyId),
        eq(portals.id, scope.portalId),
      ),
    )
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
 * Keep the primary-language text in step with the link's own label. Used when a
 * caller only knows the label (a link created or renamed through the legacy
 * path): the line, if any, is kept, and the text becomes manager-written.
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
