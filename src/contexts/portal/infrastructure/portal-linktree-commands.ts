// Portal command store — the Linktree working model: per-language link texts,
// the section's switch and its title per language.
//
// Every command takes the Portal fence first (ADR 0060) and records a pending
// change per thing that actually changed, under a structured key a change list
// can read back: `link:<id>:text:<locale>`, `linktree:title:<locale>` and
// `linktree:enabled`. The kind is `portal_links`, so no CHECK had to change.

import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalLinks, portalLocalizedOverrides, portals } from '#/shared/db/schema'
import { unbrand } from '#/shared/domain/ids'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import type {
  PortalCommandStore,
  SavePortalLinkTextsCommand,
  SavePortalLinktreeSettingsCommand,
} from '../application/ports/portal-command-store.port'
import { portalError } from '../domain/errors'
import { fencePortalContent } from './portal-aggregate-fence'
import { assertPortalContentCommand, contentScope } from './portal-content-command-guards'
import {
  assertLocalesOffered,
  readPortalLocales,
  upsertLinkTexts,
} from './portal-link-texts-store'
import { recordPortalPendingContentChange } from './portal-pending-content-changes'

export type PortalLinktreeCommandStore = Pick<
  PortalCommandStore,
  'savePortalLinkTexts' | 'savePortalLinktreeSettings'
>

type Changes = Readonly<{
  tx: Tx
  command: SavePortalLinktreeSettingsCommand
}>

function recordPending(
  tx: Tx,
  command: SavePortalLinkTextsCommand | SavePortalLinktreeSettingsCommand,
  key: string,
  sourceVersion: string,
): Promise<number> {
  return recordPortalPendingContentChange(tx, {
    ...contentScope(command),
    kind: 'portal_links',
    key,
    sourceVersion,
    changedAt: command.occurredAt,
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
        const changed = await upsertLinkTexts(
          tx,
          { ...scope, linkId },
          writer,
          command.texts,
        )
        // The legacy label mirrors the primary language until the column is dropped.
        const primary = command.texts.find((text) => text.locale === locales.primary)
        if (primary) {
          await tx
            .update(portalLinks)
            .set({ label: primary.label, updatedAt: command.occurredAt })
            .where(
              and(
                eq(portalLinks.organizationId, scope.organizationId),
                eq(portalLinks.portalId, scope.portalId),
                eq(portalLinks.id, linkId),
              ),
            )
        }
        for (const { locale, version } of changed) {
          await recordPending(tx, command, `link:${linkId}:text:${locale}`, `v${version}`)
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
          await recordPending(tx, command, 'linktree:enabled', revision)
        }
        for (const title of titles) {
          if (await saveTitle(changes, title)) {
            await recordPending(tx, command, `linktree:title:${title.locale}`, revision)
          }
        }
        await insertOutboxRow(tx, command.event, { recordedAt: command.occurredAt })
      })
    }),
})
