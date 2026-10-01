// The publication, History and review reads' wiring: every read is built from
// the one set of dependencies, so each checks the Portal's Property scope with
// the people API it was given before it touches any repository.

import { describe, expect, it } from 'vitest'
import {
  buildPortalHistoryReads,
  type PortalHistoryReadDeps,
} from './build-history-reads'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'

/** A repository that fails the test if anything reads from it. */
const untouchable = <T extends object>(name: string): T =>
  new Proxy({} as T, {
    get: (_target, property) => {
      throw new Error(`${name}.${String(property)} was read before the scope check`)
    },
  })

function wire() {
  const portal = buildTestPortal()
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const deps: PortalHistoryReadDeps = {
    portalRepo,
    portalLinkRepo: untouchable('portalLinkRepo'),
    experienceRepo: untouchable('experienceRepo'),
    publicationRepo: untouchable('publicationRepo'),
    historyRepo: untouchable('historyRepo'),
    healthRepo: untouchable('healthRepo'),
    actorDirectory: untouchable('actorDirectory'),
    portalTokenRepo: untouchable('portalTokenRepo'),
    propertyApi: untouchable('propertyApi'),
    // A manager with no Property access at all.
    staffPublicApi: {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
    },
    clock: () => new Date('2026-10-01T10:00:00.000Z'),
  }
  return { portal, reads: buildPortalHistoryReads(deps) }
}

describe('buildPortalHistoryReads', () => {
  it('offers the five reads', () => {
    expect(Object.keys(wire().reads).sort()).toEqual([
      'getPortalHistory',
      'getPortalPublicationHistory',
      'getPortalReview',
      'getPortalVersion',
      'getPortalVersions',
    ])
  })

  it('has every read refuse a manager outside the Portal’s Property before any repository is read', async () => {
    const { portal, reads } = wire()
    const manager = buildTestAuthContext({ role: 'PropertyManager' })
    const input = { portalId: portal.id }

    await expect(reads.getPortalPublicationHistory(input, manager)).rejects.toMatchObject(
      {
        code: 'forbidden',
      },
    )
    await expect(reads.getPortalHistory(input, manager)).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(reads.getPortalVersions(input, manager)).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(
      reads.getPortalVersion({ ...input, version: 1 }, manager),
    ).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(reads.getPortalReview(input, manager)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })
})
