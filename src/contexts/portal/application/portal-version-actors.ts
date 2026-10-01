// Portal context — naming the people behind versions (round 4, slice 36).
//
// A version, a draft edit and a restore each have a person at most. The
// directory answers a bounded batch, so a long list of versions is asked for in
// chunks. A person it cannot name stays in the answer with no name: the
// reader draws a neutral placeholder and never the raw identifier.

import type { OrganizationId, UserId } from '#/shared/domain/ids'
import { userId as toUserId } from '#/shared/domain/ids'
import {
  MAX_PORTAL_ACTOR_DIRECTORY_BATCH,
  type PortalActorDirectory,
} from './ports/portal-actor-directory.port'

export type PortalVersionActor = Readonly<{
  userId: string
  displayName: string | null
}>

export async function resolveVersionActors(
  directory: PortalActorDirectory,
  organizationId: OrganizationId,
  ids: ReadonlyArray<string | null>,
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))]
  const chunks: UserId[][] = []
  for (let start = 0; start < unique.length; start += MAX_PORTAL_ACTOR_DIRECTORY_BATCH) {
    chunks.push(
      unique.slice(start, start + MAX_PORTAL_ACTOR_DIRECTORY_BATCH).map(toUserId),
    )
  }
  const resolved = await Promise.all(
    chunks.map((chunk) => directory.resolveDisplayNames(organizationId, chunk)),
  )
  return new Map(resolved.flatMap((names) => [...names.entries()]))
}

export const versionActor = (
  id: string | null,
  names: ReadonlyMap<string, string>,
): PortalVersionActor | null =>
  id === null ? null : { userId: id, displayName: names.get(id) ?? null }
