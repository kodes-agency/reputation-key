// Identity asset references against real PostgreSQL: the public image route
// serves an object only while a user or an organization still points at it.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  PENDING_UPLOAD_GRACE_MS,
  reclaimPendingIdentityUploads,
} from '../../application/reclaim-pending-identity-uploads'
import { identityAssetPath } from '../../application/identity-assets'
import { createIdentityAssetReferences } from './identity-asset-references.adapter'

let lease: TestLease
let db: Database

const suffix = randomUUID()
const USER_ID = `asset-user-${suffix}`
const OTHER_USER_ID = `asset-other-user-${suffix}`
const ORG_ID = `asset-org-${suffix}`
const AT = new Date('2026-08-01T00:00:00.000Z')

const avatarKey = (userId = USER_ID) => `avatars/${userId}/${randomUUID()}`
const logoKey = (orgId = ORG_ID) => `organizations/${orgId}/logo/${randomUUID()}`

const seedUser = (id: string, image: string | null) =>
  lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt")
     VALUES ($1, 'Asset Fixture', $2, true, $3, $4, $4)`,
    [id, `${id}@example.test`, image, AT],
  )

const seedOrganization = (id: string, logo: string | null) =>
  lease.pool.query(
    `INSERT INTO organization (id, name, slug, logo, "createdAt")
     VALUES ($1, 'Asset Fixture', $1, $2, $3)`,
    [id, logo, AT],
  )

const setLogo = (id: string, logo: string | null) =>
  lease.pool.query(`UPDATE organization SET logo = $2 WHERE id = $1`, [id, logo])
const setImage = (id: string, image: string | null) =>
  lease.pool.query(`UPDATE "user" SET image = $2 WHERE id = $1`, [id, image])

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
  await seedUser(USER_ID, null)
  await seedUser(OTHER_USER_ID, null)
  await seedOrganization(ORG_ID, null)
})

afterAll(async () => {
  await lease.pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [
    [USER_ID, OTHER_USER_ID],
  ])
  await deleteTestOrganizations(lease.pool, [ORG_ID])
  await lease.release()
})

describe('identity asset references', () => {
  it('serves the avatar a user still has as their image', async () => {
    const references = createIdentityAssetReferences(db)
    const key = avatarKey()
    await setImage(USER_ID, identityAssetPath(key))

    expect(await references.isReferenced(key)).toBe(true)
    expect(await references.currentUserImage(USER_ID)).toBe(identityAssetPath(key))
  })

  it('stops serving an avatar once the user replaces it', async () => {
    const references = createIdentityAssetReferences(db)
    const first = avatarKey()
    const second = avatarKey()
    await setImage(USER_ID, identityAssetPath(first))
    await setImage(USER_ID, identityAssetPath(second))

    expect(await references.isReferenced(first)).toBe(false)
    expect(await references.isReferenced(second)).toBe(true)
  })

  it('does not serve an upload that was never saved', async () => {
    const references = createIdentityAssetReferences(db)
    await setImage(USER_ID, identityAssetPath(avatarKey()))

    expect(await references.isReferenced(avatarKey())).toBe(false)
    expect(await references.isReferenced(logoKey())).toBe(false)
  })

  it('does not serve an avatar through another user who points at the same address', async () => {
    const references = createIdentityAssetReferences(db)
    const key = avatarKey(USER_ID)
    await setImage(USER_ID, null)
    await setImage(OTHER_USER_ID, identityAssetPath(key))

    expect(await references.isReferenced(key)).toBe(false)
    await setImage(OTHER_USER_ID, null)
  })

  it('does not serve the avatar of a user who no longer exists', async () => {
    const references = createIdentityAssetReferences(db)
    const gone = `asset-gone-${suffix}`
    const key = avatarKey(gone)
    await seedUser(gone, identityAssetPath(key))
    expect(await references.isReferenced(key)).toBe(true)

    await lease.pool.query(`DELETE FROM "user" WHERE id = $1`, [gone])

    expect(await references.isReferenced(key)).toBe(false)
  })

  it('serves the logo an organization still has, and not a replaced one', async () => {
    const references = createIdentityAssetReferences(db)
    const first = logoKey()
    const second = logoKey()
    await setLogo(ORG_ID, identityAssetPath(first))
    expect(await references.isReferenced(first)).toBe(true)
    expect(await references.currentOrganizationLogo(ORG_ID)).toBe(
      identityAssetPath(first),
    )

    await setLogo(ORG_ID, identityAssetPath(second))

    expect(await references.isReferenced(first)).toBe(false)
    expect(await references.isReferenced(second)).toBe(true)
  })

  it('serves nothing for a key of another shape', async () => {
    const references = createIdentityAssetReferences(db)

    expect(await references.isReferenced('portal-media/abc.webp')).toBe(false)
  })

  it('reports no current image or logo for an unknown owner', async () => {
    const references = createIdentityAssetReferences(db)

    expect(await references.currentUserImage('nobody')).toBeNull()
    expect(await references.currentOrganizationLogo('nobody')).toBeNull()
  })

  it('reclaims only unreferenced uploads, across users and organizations', async () => {
    const references = createIdentityAssetReferences(db)
    const kept = avatarKey(USER_ID)
    const keptLogo = logoKey()
    const abandoned = avatarKey(USER_ID)
    const abandonedOther = avatarKey(OTHER_USER_ID)
    const abandonedLogo = logoKey()
    await setImage(USER_ID, identityAssetPath(kept))
    await setImage(OTHER_USER_ID, null)
    await setLogo(ORG_ID, identityAssetPath(keptLogo))
    const now = new Date()
    const old = new Date(now.getTime() - PENDING_UPLOAD_GRACE_MS - 1000)
    const stored = [kept, keptLogo, abandoned, abandonedOther, abandonedLogo]
    const deleted: string[] = []

    const outcome = await reclaimPendingIdentityUploads({
      storage: {
        listObjects: async (prefix) => ({
          objects: stored
            .filter((key) => key.startsWith(prefix))
            .map((key) => ({ key, lastModified: old })),
          truncated: false,
        }),
        deleteObject: async (key) => {
          deleted.push(key)
        },
      },
      isReferenced: references.isReferenced,
      clock: () => now,
      logger: { warn: () => {} },
    })()

    expect(deleted.sort()).toEqual([abandoned, abandonedOther, abandonedLogo].sort())
    expect(outcome).toMatchObject({ reclaimed: 3, failed: 0 })
  })
})
