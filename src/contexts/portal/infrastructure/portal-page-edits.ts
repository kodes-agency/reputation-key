import { and, desc, eq, gte, isNull, sql, type SQL } from 'drizzle-orm'
import {
  portalPageEdits,
  portalPublicationActivations,
} from '#/shared/db/schema/portal-publication.schema'
import type { Tx } from '#/shared/outbox/commit'
import {
  PORTAL_PAGE_EDIT_FOLD_WINDOW_MS,
  clipPageEditText,
  isPropertyWideEditKind,
  pageEditCarriesWording,
  type PortalPageEditKind,
} from '../domain/portal-page-edit'
import { recordPortalPendingContentChange } from './portal-pending-content-changes'

const MAX_KEY_LENGTH = 160

/**
 * What one save changed: the part of the page and, for a change of wording, the
 * text before and after. Leaving both out says the save changed no wording;
 * `null` says there was none (a first title, a reset one).
 */
export type PortalPageEditEntry = Readonly<{
  key: string
  previousText?: string | null
  newText?: string | null
}>

export type PortalPageEditInput = Readonly<{
  organizationId: string
  propertyId: string
  /** The Portal edited, or the Portals a shared record (a destination) reaches. */
  portalId?: string
  portalIds?: readonly string[]
  kind: PortalPageEditKind
  key?: string
  /** The wording before this change; only for a key that says wording changed. */
  previousText?: string | null
  /** The wording after this change; only for a key that says wording changed. */
  newText?: string | null
  /** Null when the system made the change. */
  actorUserId: string | null
  occurredAt: Date
}>

type EditScope = Readonly<{
  organizationId: string
  propertyId: string
  /** Null for a Property-wide row. */
  portalId: string | null
}>

type EditChange = Readonly<{
  kind: PortalPageEditKind
  key: string
  /** Null when the save changed no wording. */
  wording: Readonly<{ previousText: string | null; newText: string | null }> | null
  actorUserId: string | null
  occurredAt: Date
}>

const sameActor = (actorUserId: string | null): SQL =>
  actorUserId === null
    ? isNull(portalPageEdits.actorUserId)
    : eq(portalPageEdits.actorUserId, actorUserId)

const portalCondition = (portalId: string | null): SQL =>
  portalId === null
    ? isNull(portalPageEdits.portalId)
    : eq(portalPageEdits.portalId, portalId)

/** True when a publication of the Portal (or, for a Property-wide row, of any Portal in the Property) is at or after `since`. */
async function publishedSince(tx: Tx, scope: EditScope, since: Date): Promise<boolean> {
  const [activation] = await tx
    .select({ id: portalPublicationActivations.id })
    .from(portalPublicationActivations)
    .where(
      and(
        eq(portalPublicationActivations.organizationId, scope.organizationId),
        eq(portalPublicationActivations.propertyId, scope.propertyId),
        scope.portalId === null
          ? undefined
          : eq(portalPublicationActivations.portalId, scope.portalId),
        gte(portalPublicationActivations.activatedAt, since),
      ),
    )
    .limit(1)
  return activation !== undefined
}

/**
 * Fold this save into the newest row for the same part by the same person when
 * that row is still open: recent, and no publication since. The row keeps the
 * wording it started from and takes the latest wording; `occurred_at` moves to
 * this save. A row that recorded wording keeps its "before" even when that was
 * none; a row that recorded none takes the first wording that comes. Returns
 * whether it was folded.
 */
async function foldIntoOpenRow(
  tx: Tx,
  scope: EditScope,
  change: EditChange,
): Promise<boolean> {
  const [latest] = await tx
    .select({
      id: portalPageEdits.id,
      occurredAt: portalPageEdits.occurredAt,
      previousText: portalPageEdits.previousText,
      newText: portalPageEdits.newText,
    })
    .from(portalPageEdits)
    .where(
      and(
        eq(portalPageEdits.organizationId, scope.organizationId),
        eq(portalPageEdits.propertyId, scope.propertyId),
        portalCondition(scope.portalId),
        eq(portalPageEdits.changeKind, change.kind),
        eq(portalPageEdits.changeKey, change.key),
        sameActor(change.actorUserId),
      ),
    )
    .orderBy(desc(portalPageEdits.occurredAt), desc(portalPageEdits.id))
    .limit(1)
    .for('update')
  if (!latest) return false
  const gap = change.occurredAt.getTime() - latest.occurredAt.getTime()
  if (gap < 0 || gap >= PORTAL_PAGE_EDIT_FOLD_WINDOW_MS) return false
  if (await publishedSince(tx, scope, latest.occurredAt)) return false
  const startedWithWording = latest.previousText !== null || latest.newText !== null
  await tx
    .update(portalPageEdits)
    .set({
      occurredAt: change.occurredAt,
      editCount: sql`${portalPageEdits.editCount} + 1`,
      ...(change.wording === null
        ? {}
        : {
            previousText: startedWithWording
              ? latest.previousText
              : change.wording.previousText,
            newText: change.wording.newText,
          }),
    })
    .where(eq(portalPageEdits.id, latest.id))
  return true
}

async function writeEdit(tx: Tx, scope: EditScope, change: EditChange): Promise<void> {
  if (await foldIntoOpenRow(tx, scope, change)) return
  await tx.insert(portalPageEdits).values({
    organizationId: scope.organizationId,
    propertyId: scope.propertyId,
    portalId: scope.portalId,
    changeKind: change.kind,
    changeKey: change.key,
    previousText: change.wording?.previousText ?? null,
    newText: change.wording?.newText ?? null,
    actorUserId: change.actorUserId,
    occurredAt: change.occurredAt,
  })
}

/**
 * Record the page-edit ledger rows for one change, inside the caller's
 * transaction. A Property-wide kind writes one row for the Property; any other
 * kind writes one row per Portal it names, whether or not that Portal was ever
 * published (a draft's edits are history too). A save of a part the same person
 * saved moments ago, with no publication between, folds into that row instead
 * of adding one. Returns the number of Portals (or 1 for the Property) it
 * recorded for.
 */
export async function recordPortalPageEdit(
  tx: Tx,
  input: PortalPageEditInput,
): Promise<number> {
  const key = input.key?.trim() || 'all'
  if (key.length > MAX_KEY_LENGTH) {
    throw new Error('Portal page-edit key exceeds its storage contract')
  }
  const hasWording = input.previousText !== undefined || input.newText !== undefined
  if (hasWording && !pageEditCarriesWording(input.kind, key)) {
    throw new Error(
      'A Portal page edit that is not a change of wording must not carry wording',
    )
  }
  const isWide = isPropertyWideEditKind(input.kind)
  const named =
    input.portalIds ?? (input.portalId === undefined ? undefined : [input.portalId])
  if (!isWide && named === undefined) {
    throw new Error('A Portal page edit must name its Portal')
  }
  const portalIds = isWide ? [null] : [...new Set(named)].sort()
  const change: EditChange = {
    kind: input.kind,
    key,
    wording: hasWording
      ? {
          previousText: clipPageEditText(input.previousText),
          newText: clipPageEditText(input.newText),
        }
      : null,
    actorUserId: input.actorUserId,
    occurredAt: input.occurredAt,
  }
  for (const portalId of portalIds) {
    await writeEdit(
      tx,
      { organizationId: input.organizationId, propertyId: input.propertyId, portalId },
      change,
    )
  }
  return portalIds.length
}

type PendingInput = Parameters<typeof recordPortalPendingContentChange>[1]

/**
 * The one way a working-copy change is recorded: the pending-change fence that
 * says "guests do not see this yet" and the page-edit ledger rows that say who
 * did what. Every write that moves a published input goes through here, so none
 * can leave one without the other. The fence key stays coarse (it only has to
 * say which input moved); `ledger` names each part that changed, one row each,
 * so the History can say "renamed the Dinner menu". An empty `ledger` is a
 * save that moved nothing nameable: the fence opens as it always did and no
 * History entry is made. Returns the number of fences newly opened.
 */
export async function recordPortalContentChange(
  tx: Tx,
  input: Omit<PendingInput, 'key' | 'changedBy'> &
    Readonly<{
      key?: string
      actorUserId: string | null
      ledger: readonly PortalPageEditEntry[]
    }>,
): Promise<number> {
  const { actorUserId, ledger, ...fence } = input
  for (const entry of ledger) {
    await recordPortalPageEdit(tx, {
      organizationId: fence.organizationId,
      propertyId: fence.propertyId,
      portalId: fence.portalId,
      portalIds: fence.portalIds,
      kind: fence.kind,
      key: entry.key,
      previousText: entry.previousText,
      newText: entry.newText,
      actorUserId,
      occurredAt: fence.changedAt,
    })
  }
  return recordPortalPendingContentChange(tx, { ...fence, changedBy: actorUserId })
}
