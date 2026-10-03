import { describe, expect, it, vi } from 'vitest'
import { organizationId } from '#/shared/domain/ids'
import type { UserId } from '#/shared/domain/ids'
import type { PortalActorDirectory } from './ports/portal-actor-directory.port'
import {
  OPERATOR_ACTOR_LABEL,
  versionActor,
  resolveVersionActors,
} from './portal-version-actors'

const ORG = organizationId('org-version-actors-0000000000000001')

describe('portal actors', () => {
  it('names a person from the directory, or leaves the name empty', () => {
    const names = new Map([['elena', 'Elena Petrova']])
    expect(versionActor('elena', names)).toEqual({
      userId: 'elena',
      displayName: 'Elena Petrova',
    })
    expect(versionActor('gone', names)).toEqual({ userId: 'gone', displayName: null })
    expect(versionActor(null, names)).toBeNull()
  })

  it('shows an operator under the fixed label with no operator identity', () => {
    expect(versionActor('ops:denev', new Map())).toEqual({
      userId: 'reputation-key',
      displayName: OPERATOR_ACTOR_LABEL,
    })
    expect(OPERATOR_ACTOR_LABEL).toBe('Reputation Key')
  })

  it('never asks the directory about an operator', async () => {
    const resolveDisplayNames = vi.fn(
      async (_org: unknown, ids: readonly UserId[]) =>
        new Map(ids.map((id) => [id, `name of ${id}`] as const)),
    )
    const directory: PortalActorDirectory = { resolveDisplayNames }

    const names = await resolveVersionActors(directory, ORG, ['ops:denev', 'elena', null])

    expect(resolveDisplayNames).toHaveBeenCalledTimes(1)
    expect(resolveDisplayNames.mock.calls[0]?.[1]).toEqual(['elena'])
    expect([...names.keys()]).toEqual(['elena'])
  })
})
