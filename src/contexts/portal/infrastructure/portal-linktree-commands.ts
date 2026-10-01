// Portal command store — the Linktree working model: per-language link texts,
// the section's switch and its title per language.
//
// Every command takes the Portal fence first (ADR 0060) and records a pending
// change per thing that actually changed, under a structured key a change list
// can read back: `link:<id>:text:<locale>`, `linktree:title:<locale>` and
// `linktree:enabled`. The kind is `portal_links`, so no CHECK had to change.
// The same key names the page-edit ledger row; a text or a title that changed
// also keeps its wording before and after there.

import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalLinks,
  portalLinkTexts,
  portalLocalizedOverrides,
  portals,
} from '#/shared/db/schema'
import { unbrand } from '#/shared/domain/ids'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import type {
  PortalCommandStore,
  SavePortalLinkTextsCommand,
  SavePortalLinktreeSettingsCommand,
} from '../application/ports/portal-command-store.port'
import { portalError } from '../domain/errors'
import { portalPageEditKey } from '../domain/portal-page-edit'
import { fencePortalContent } from './portal-aggregate-fence'
import { assertPortalContentCommand, contentScope } from './portal-content-command-guards'
import {
  assertLocalesOffered,
  readPortalLocales,
  upsertLinkTexts,
} from './portal-link-texts-store'
import { recordPortalContentChange } from './portal-page-edits'

export type PortalLinktreeCommandStore = Pick<
  PortalCommandStore,
  'savePortalLinkTexts' | 'savePortalLinktreeSettings'
>

type Changes = Readonly<{
  tx: Tx
  command: SavePortalLinktreeSettingsCommand
}>

/** The wording of one text before and after; null when the save changed none. */
type Wording = Readonly<{ previousText: string | null; newText: string | null }>

function recordPending(
  tx: Tx,
  command: SavePortalLinkTextsCommand | SavePortalLinktreeSettingsCommand,
  key: string,
  sourceVersion: string,
  wording: Wording | null = null,
): Promise<number> {
  return recordPortalContentChange(tx, {
    ...contentScope(command),
    kind: 'portal_links',
    key,
    ledger: [{ key, ...wording }],
    sourceVersion,
    changedAt: command.occurredAt,
    actorUserId: unbrand(command.actorUserId),
  })
}

/** Turn the section on or off; true when the value actually changed. */
async function saveEnabled({ tx, command }: Changes, enabled: boolean): Promise<boolean> {
  const scope = contentScope(command)
  const changed = await tx
    .update(portals)
    .set({ linktreeEnabled: enabled })
    .where(
      and(
        eq(portals.organizationId, scope.organizationId),
        eq(portals.propertyId, scope.propertyId),
        eq(portals.id, scope.portalId),
        sql`${portals.linktreeEnabled} IS DISTINCT FROM ${enabled}`,
      ),
    )
    .returning({ id: portals.id })
  return changed.length > 0
}

/** The stored title of one language, before it is written; null when it has none. */
async function readTitle(
  { tx, command }: Changes,
  locale: string,
): Promise<string | null> {
  const scope = contentScope(command)
  const [row] = await tx
    .select({ title: portalLocalizedOverrides.linktreeTitle })
    .from(portalLocalizedOverrides)
    .where(
      and(
        eq(portalLocalizedOverrides.organizationId, scope.organizationId),
        eq(portalLocalizedOverrides.propertyId, scope.propertyId),
        eq(portalLocalizedOverrides.portalId, scope.portalId),
        eq(portalLocalizedOverrides.locale, locale),
      ),
    )
    .limit(1)
  return row?.title ?? null
}

/** Set or reset one language's title; true when the stored title actually changed. */
async function saveTitle(
  { tx, command }: Changes,
  input: NonNullable<SavePortalLinktreeSettingsCommand['titles']>[number],
): Promise<boolean> {
  const scope = contentScope(command)
  const writer = {
    updatedBy: unbrand(command.actorUserId),
    updatedAt: command.occurredAt,
  }
  const rowScope = and(
    eq(portalLocalizedOverrides.organizationId, scope.organizationId),
    eq(portalLocalizedOverrides.propertyId, scope.propertyId),
    eq(portalLocalizedOverrides.portalId, scope.portalId),
    eq(portalLocalizedOverrides.locale, input.locale),
  )
  if (input.title !== null) {
    const saved = await tx
      .insert(portalLocalizedOverrides)
      .values({
        id: input.overrideId,
        ...scope,
        locale: input.locale,
        linktreeTitle: input.title,
        version: 1,
        ...writer,
        createdAt: command.occurredAt,
      })
      .onConflictDoUpdate({
        target: [
          portalLocalizedOverrides.organizationId,
          portalLocalizedOverrides.portalId,
          portalLocalizedOverrides.locale,
        ],
        set: {
          linktreeTitle: input.title,
          version: sql`${portalLocalizedOverrides.version} + 1`,
          ...writer,
        },
        setWhere: sql`${portalLocalizedOverrides.linktreeTitle} IS DISTINCT FROM ${input.title}`,
      })
      .returning({ id: portalLocalizedOverrides.id })
    return saved.length > 0
  }
  // Reset: a row that holds other fields keeps them; one that only held the
  // title goes away (the has-value CHECK forbids an empty row).
  const cleared = await tx
    .update(portalLocalizedOverrides)
    .set({
      linktreeTitle: null,
      version: sql`${portalLocalizedOverrides.version} + 1`,
      ...writer,
    })
    .where(
      and(
        rowScope,
        isNotNull(portalLocalizedOverrides.linktreeTitle),
        or(
          isNotNull(portalLocalizedOverrides.title),
          isNotNull(portalLocalizedOverrides.shortDescription),
          isNotNull(portalLocalizedOverrides.heroImageUrl),
        ),
      ),
    )
    .returning({ id: portalLocalizedOverrides.id })
  if (cleared.length > 0) return true
  const removed = await tx
    .delete(portalLocalizedOverrides)
    .where(
      and(
        rowScope,
        isNotNull(portalLocalizedOverrides.linktreeTitle),
        isNull(portalLocalizedOverrides.title),
        isNull(portalLocalizedOverrides.shortDescription),
        isNull(portalLocalizedOverrides.heroImageUrl),
      ),
    )
    .returning({ id: portalLocalizedOverrides.id })
  return removed.length > 0
}

/** The label of each language a link has a text in, before a save. */
async function readLabels(
  tx: Tx,
  scope: ReturnType<typeof contentScope>,
  linkId: string,
): Promise<ReadonlyMap<string, string>> {
  const rows = await tx
    .select({ locale: portalLinkTexts.locale, label: portalLinkTexts.label })
    .from(portalLinkTexts)
    .where(
      and(
        eq(portalLinkTexts.organizationId, scope.organizationId),
        eq(portalLinkTexts.portalId, scope.portalId),
        eq(portalLinkTexts.linkId, linkId),
      ),
    )
  return new Map(rows.map((row) => [row.locale, row.label]))
}

export const createPortalLinktreeCommands = (
  db: Database,
): PortalLinktreeCommandStore => ({
  savePortalLinkTexts: async (command) =>
    trace('portal.commandStore.savePortalLinkTexts', async () => {
      assertPortalContentCommand(command)
      await db.transaction(async (tx) => {
        await fencePortalContent(tx, command)
        const scope = contentScope(command)
        const linkId = unbrand(command.linkId)
        const [link] = await tx
          .select({ id: portalLinks.id })
          .from(portalLinks)
          .where(
            and(
              eq(portalLinks.organizationId, scope.organizationId),
              eq(portalLinks.portalId, scope.portalId),
              eq(portalLinks.categoryId, unbrand(command.categoryId)),
              eq(portalLinks.id, linkId),
            ),
          )
          .limit(1)
        if (!link) {
          throw portalError('revision_conflict', 'Portal link changed during update')
        }
        const locales = await readPortalLocales(tx, scope)
        assertLocalesOffered(
          locales,
          command.texts.map((text) => text.locale),
        )
        const writer = {
          actorUserId: unbrand(command.actorUserId),
          at: command.occurredAt,
        }
        const labelsBefore = await readLabels(tx, scope, linkId)
        const changed = await upsertLinkTexts(
          tx,
          { ...scope, linkId },
          writer,
          command.texts,
        )
        for (const { locale, version } of changed) {
          const previousText = labelsBefore.get(locale) ?? null
          const newText =
            command.texts.find((text) => text.locale === locale)?.label ?? null
          await recordPending(
            tx,
            command,
            portalPageEditKey.linkText(linkId, locale),
            `v${version}`,
            previousText === newText ? null : { previousText, newText },
          )
        }
        await insertOutboxRow(tx, command.event, { recordedAt: command.occurredAt })
      })
    }),

  savePortalLinktreeSettings: async (command) =>
    trace('portal.commandStore.savePortalLinktreeSettings', async () => {
      assertPortalContentCommand(command)
      await db.transaction(async (tx) => {
        await fencePortalContent(tx, command)
        const scope = contentScope(command)
        const titles = command.titles ?? []
        assertLocalesOffered(
          await readPortalLocales(tx, scope),
          titles.map((title) => title.locale),
        )
        const changes = { tx, command }
        const revision = `v${command.revision.toISOString()}`
        if (
          command.enabled !== undefined &&
          (await saveEnabled(changes, command.enabled))
        ) {
          await recordPending(tx, command, portalPageEditKey.linktreeEnabled(), revision)
        }
        for (const title of titles) {
          const previousText = await readTitle(changes, title.locale)
          if (await saveTitle(changes, title)) {
            await recordPending(
              tx,
              command,
              portalPageEditKey.linktreeTitle(title.locale),
              revision,
              { previousText, newText: title.title },
            )
          }
        }
        await insertOutboxRow(tx, command.event, { recordedAt: command.occurredAt })
      })
    }),
})
