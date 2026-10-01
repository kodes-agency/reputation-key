// Portal command store — what an update of the Portal's own settings changed,
// for the pending-change fence and the page-edit ledger.
//
// The fence only needs to know that the working copy moved; the ledger names
// each setting that actually changed (`settings:<field>`) and, for the two that
// are wording (the name and the description), the text before and after. The
// "before" is read inside the command's transaction, ahead of the write.

import { and, eq } from 'drizzle-orm'
import { portals } from '#/shared/db/schema'
import { unbrand } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import type { UpdatePortalCommand } from '../application/ports/portal-command-store.port'
import {
  portalPageEditKey,
  portalSettingField,
  type PortalSettingField,
} from '../domain/portal-page-edit'
import { contentScope } from './portal-content-command-guards'
import {
  recordPortalContentChange,
  recordPortalPageEdit,
  type PortalPageEditEntry,
} from './portal-page-edits'

/** The working-copy settings of a Portal as the update patch names them. */
export type PortalSettingsBefore = Readonly<Record<string, unknown>>

const WORDING_FIELDS: readonly PortalSettingField[] = ['name', 'description']

/** Whether a patch touches any working-copy setting (state changes alone do not). */
export function hasPortalWorkingCopyPatch(patch: UpdatePortalCommand['patch']): boolean {
  return Object.keys(patch).some((key) => portalSettingField(key) !== null)
}

/** The settings as stored, read before the update inside its transaction. */
export async function readPortalSettings(
  tx: Tx,
  command: UpdatePortalCommand,
): Promise<PortalSettingsBefore> {
  const scope = contentScope(command)
  const [row] = await tx
    .select({
      name: portals.name,
      slug: portals.slug,
      description: portals.description,
      heroImageUrl: portals.heroImageUrl,
      theme: portals.theme,
      privateFeedbackThreshold: portals.privateFeedbackThreshold,
      primaryGuestLocale: portals.primaryGuestLocale,
      additionalGuestLocales: portals.additionalGuestLocales,
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
  return row ?? {}
}

/** JSON with sorted keys, so two equal settings compare equal whatever their key order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

const textOf = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

/** One ledger entry per setting the patch actually changed. */
export function changedSettingEntries(
  before: PortalSettingsBefore,
  patch: UpdatePortalCommand['patch'],
): readonly PortalPageEditEntry[] {
  return Object.entries(patch).flatMap(([patchKey, next]) => {
    const field = portalSettingField(patchKey)
    if (field === null || stableJson(before[patchKey]) === stableJson(next)) return []
    const key = portalPageEditKey.setting(field)
    return WORDING_FIELDS.includes(field)
      ? [{ key, previousText: textOf(before[patchKey]), newText: textOf(next) }]
      : [{ key }]
  })
}

/**
 * Record an update of the settings. The fence opens for any working-copy patch
 * unless the command publishes it (publishing resolves the fence it would
 * open). The ledger names each changed setting either way, so a patch that is
 * published in the same command still shows who made it.
 */
export async function recordPortalSettingsChange(
  tx: Tx,
  command: UpdatePortalCommand,
  before: PortalSettingsBefore,
): Promise<void> {
  if (!hasPortalWorkingCopyPatch(command.patch)) return
  const ledger = changedSettingEntries(before, command.patch)
  const scope = contentScope(command)
  const actorUserId = unbrand(command.actorUserId)
  if (command.publication?.kind === 'publish') {
    for (const entry of ledger) {
      await recordPortalPageEdit(tx, {
        ...scope,
        kind: 'portal_configuration',
        key: entry.key,
        previousText: entry.previousText,
        newText: entry.newText,
        actorUserId,
        occurredAt: command.occurredAt,
      })
    }
    return
  }
  await recordPortalContentChange(tx, {
    ...scope,
    kind: 'portal_configuration',
    ledger,
    sourceVersion: command.revision.toISOString(),
    changedAt: command.occurredAt,
    actorUserId,
  })
}
