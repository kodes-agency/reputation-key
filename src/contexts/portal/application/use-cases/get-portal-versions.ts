// Portal context — the versions rail of the History tab (round 4, slice 36).
//
// Every published version of a Portal, newest first, with who published it,
// whether it is the one guests see and what it added over the version before
// it (a pure comparison of the two immutable snapshots). Beside them, what the
// draft is based on and who last edited it, so the rail can say "Draft · based
// on version 5 · edited 2 h ago by Elena". Authorization is `portal.read` in
// the Portal's Property, the same as the rest of History.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalHistoryRepository } from '../ports/portal-history.repository'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalActorDirectory } from '../ports/portal-actor-directory.port'
import { loadPortalOrThrow } from '../load-accessible-portal'
import {
  resolveVersionActors,
  versionActor,
  type PortalVersionActor,
} from '../portal-version-actors'
import {
  diffPublicationContent,
  publicationContentView,
  type PublicationContentChange,
} from '../../domain/portal-publication-content'

/** More versions than a Portal is ever published; older ones are named, not listed. */
const MAX_LISTED_VERSIONS = 200

export type PortalVersionItem = Readonly<{
  version: number
  publishedAt: string
  publishedBy: PortalVersionActor | null
  /** The version guests see right now. */
  isLive: boolean
  /** Nothing came before it. */
  isFirst: boolean
  languages: readonly GuestLocale[]
  /** What it added over the version before it; everything, for the first. */
  changes: readonly PublicationContentChange[]
}>

export type PortalVersions = Readonly<{
  /** Newest first. */
  versions: readonly PortalVersionItem[]
  liveVersion: number | null
  draft: Readonly<{
    /** The live version, else the newest; null before the first publication. */
    basedOnVersion: number | null
    /** The newest page edit that is in no published version yet. */
    lastEdit: Readonly<{ at: string; actor: PortalVersionActor | null }> | null
  }>
  /** Older versions exist than were listed. */
  truncated: boolean
}>

type Deps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  historyRepo: PortalHistoryRepository
  publicationRepo: PortalPublicationRepository
  actorDirectory: PortalActorDirectory
}>

export const getPortalVersions =
  (deps: Deps) =>
  async (
    input: Readonly<{ portalId: string }>,
    ctx: AuthContext,
  ): Promise<PortalVersions> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.read',
      forbiddenMessage: 'Insufficient permissions to view Portal versions',
    })
    const { organizationId } = ctx
    const { propertyId } = portal
    // One more than listed: the version before the oldest one listed, which is
    // what the oldest is compared with, and the proof that older ones exist.
    const [rows, active, edits] = await Promise.all([
      deps.historyRepo.listPublishedVersions(
        organizationId,
        propertyId,
        portal.id,
        MAX_LISTED_VERSIONS + 1,
      ),
      deps.publicationRepo.findActiveForPortal(organizationId, portal.id),
      deps.historyRepo.listPageEdits(
        organizationId,
        propertyId,
        portal.id,
        { bound: null, limit: 1 },
        portal.createdAt,
      ),
    ])
    const listed = rows.slice(0, MAX_LISTED_VERSIONS)
    const newest = listed[0]
    const lastEdit = edits[0]
    const draftEdit =
      lastEdit && (!newest || lastEdit.occurredAt > newest.publishedAt) ? lastEdit : null
    const names = await resolveVersionActors(deps.actorDirectory, organizationId, [
      ...listed.map((row) => row.publishedBy),
      draftEdit?.actorUserId ?? null,
    ])
    const liveVersion = active?.version ?? null

    return {
      versions: listed.map((row, index): PortalVersionItem => {
        const before = rows[index + 1]
        return {
          version: row.version,
          publishedAt: row.publishedAt.toISOString(),
          publishedBy: versionActor(row.publishedBy, names),
          isLive: row.version === liveVersion,
          isFirst: before === undefined,
          languages: publicationContentView(row.configuration).locales,
          changes: diffPublicationContent(
            before?.configuration ?? null,
            row.configuration,
          ),
        }
      }),
      liveVersion,
      draft: {
        basedOnVersion: liveVersion ?? newest?.version ?? null,
        lastEdit: draftEdit
          ? {
              at: draftEdit.occurredAt.toISOString(),
              actor: versionActor(draftEdit.actorUserId, names),
            }
          : null,
      },
      truncated: rows.length > MAX_LISTED_VERSIONS,
    }
  }

export type GetPortalVersions = ReturnType<typeof getPortalVersions>
