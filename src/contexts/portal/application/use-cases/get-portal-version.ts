// Portal context — one published version, for "View" and "Make live again"
// (round 4, slice 36).
//
// What the version shows guests, in plain words, and what making it live
// would change: the comparison runs from the version guests see now to this
// one, so "added" means "comes back" and "removed" means "goes away". Nothing
// here writes; the restore itself is `rollbackPortalPublication`. Authorization
// is `portal.read`: seeing a version needs no more than seeing the History.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalActorDirectory } from '../ports/portal-actor-directory.port'
import { loadPortalOrThrow } from '../load-accessible-portal'
import {
  resolveVersionActors,
  versionActor,
  type PortalVersionActor,
} from '../portal-version-actors'
import { portalError } from '../../domain/errors'
import {
  diffPublicationContent,
  publicationContentView,
  type PublicationContentChange,
} from '../../domain/portal-publication-content'

export type PortalVersionContent = Readonly<{
  primaryLanguage: GuestLocale
  languages: readonly GuestLocale[]
  /** The title in the primary language; null when the version has none. */
  title: string | null
  links: ReadonlyArray<Readonly<{ label: string; address: string }>>
  /** Null for versions from before the section had a switch. */
  linktreeEnabled: boolean | null
}>

export type PortalVersionDetail = Readonly<{
  version: number
  publishedAt: string
  publishedBy: PortalVersionActor | null
  isLive: boolean
  liveVersion: number | null
  /** The number publishing the draft would get. */
  nextVersion: number
  content: PortalVersionContent
  /** From the live version to this one; empty for the live one, or with none live. */
  changesFromLive: readonly PublicationContentChange[]
}>

type Deps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  publicationRepo: PortalPublicationRepository
  actorDirectory: PortalActorDirectory
}>

export const getPortalVersion =
  (deps: Deps) =>
  async (
    input: Readonly<{ portalId: string; version: number }>,
    ctx: AuthContext,
  ): Promise<PortalVersionDetail> => {
    const pid = portalId(input.portalId)
    await loadPortalOrThrow(deps, ctx, pid, {
      permission: 'portal.read',
      forbiddenMessage: 'Insufficient permissions to view a Portal version',
    })
    const unavailable = () =>
      portalError(
        'publication_snapshot_unavailable',
        'The requested publication version is unavailable for this Portal',
      )
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw unavailable()

    const { organizationId } = ctx
    const [target, live, cursor] = await Promise.all([
      deps.publicationRepo.findSnapshotByVersion(organizationId, pid, input.version),
      deps.publicationRepo.findActiveForPortal(organizationId, pid),
      deps.publicationRepo.getCursor(organizationId, pid),
    ])
    if (!target) throw unavailable()

    const names = await resolveVersionActors(deps.actorDirectory, organizationId, [
      target.createdBy,
    ])
    const view = publicationContentView(target.configuration)
    const isLive = live?.version === target.version
    return {
      version: target.version,
      publishedAt: target.createdAt.toISOString(),
      publishedBy: versionActor(target.createdBy, names),
      isLive,
      liveVersion: live?.version ?? null,
      nextVersion: cursor.nextSnapshotVersion,
      content: {
        primaryLanguage: view.primaryLocale,
        languages: view.locales,
        title: view.wording[view.primaryLocale]?.title ?? null,
        links: view.links.map((link) => ({ label: link.label, address: link.address })),
        linktreeEnabled: view.linktreeEnabled,
      },
      changesFromLive:
        live && !isLive
          ? diffPublicationContent(live.configuration, target.configuration)
          : [],
    }
  }

export type GetPortalVersion = ReturnType<typeof getPortalVersion>
