// Portal command store — the rows a Portal takes over from another: its wording, links
// and their texts, and its own look. Shared by a new Portal's commit and by a person's
// guest page taking over another Portal's content, so a copy reads the same in both.

import {
  portalLinkCategories,
  portalLinks,
  portalLocalizedOverrides,
  portalLookOverrides,
} from '#/shared/db/schema'
import type { Tx } from '#/shared/outbox/commit'
import type { CreatePortalCopiedContent } from '../publication/portal-command-store-port.server'
import { portalError } from '../domain/errors'
import { categoryToRow, newLinkToRow } from './mappers/portal-link.mapper'
import { upsertLinkTexts } from './portal-link-texts-store'
import { isForeignKeyViolation } from './portal-unique-violation'

export type CopiedContentScope = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  actorUserId: string
  at: Date
}>

/** The images a copied look points at; one gone since the source was read refuses the copy. */
const COPIED_LOOK_IMAGE_KEYS = [
  'portal_look_overrides_hero_asset_fk',
  'portal_look_overrides_logo_asset_fk',
] as const

/** The commit, with such an image answered as a refusal, not a fault. */
export async function refusingGoneLookImage(commit: () => Promise<void>): Promise<void> {
  try {
    await commit()
  } catch (error) {
    if (COPIED_LOOK_IMAGE_KEYS.some((key) => isForeignKeyViolation(error, key))) {
      throw portalError(
        'revision_conflict',
        'The look of the portal you started from changed. Try again.',
      )
    }
    throw error
  }
}

export async function insertCopiedContent(
  tx: Tx,
  scope: CopiedContentScope,
  copy: CreatePortalCopiedContent,
): Promise<void> {
  const { organizationId, propertyId, portalId, actorUserId, at } = scope
  const writer = { actorUserId, at }
  // Before the links: a source with no link to copy still carries its look.
  if (copy.look) {
    await tx.insert(portalLookOverrides).values({
      organizationId,
      propertyId,
      portalId,
      ...copy.look,
      updatedBy: actorUserId,
      createdAt: at,
      updatedAt: at,
    })
  }
  if (copy.overrides.length > 0) {
    await tx.insert(portalLocalizedOverrides).values(
      copy.overrides.map((override) => ({
        id: override.id,
        organizationId,
        propertyId,
        portalId,
        locale: override.locale,
        title: override.title,
        shortDescription: override.shortDescription,
        heroImageUrl: null,
        linktreeTitle: override.linktreeTitle,
        version: 1,
        updatedBy: actorUserId,
        createdAt: at,
        updatedAt: at,
      })),
    )
  }
  if (copy.categories.length > 0) {
    await tx.insert(portalLinkCategories).values(copy.categories.map(categoryToRow))
  }
  if (copy.links.length === 0) return
  await tx.insert(portalLinks).values(copy.links.map(newLinkToRow))
  for (const link of copy.links) {
    await upsertLinkTexts(
      tx,
      { organizationId, propertyId, portalId, linkId: String(link.id) },
      writer,
      copy.linkTexts.filter((text) => text.linkId === link.id),
    )
  }
}
