// `requests.updateOrganization` as the build wires it, against real PostgreSQL.
//
// The server function calls this instance and nothing else, so it must do what
// the Organization page promises: a removed logo is saved as removed, and the
// object it was is freed once that is saved. It used to be built without the
// two cleanup dependencies, while the server function composed its own copy
// that had them.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { organizationId, userId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { identityAssetPath } from './application/identity-assets'
import { buildIdentityContext } from './build'

const db = getDb()
const ORG = 'org-build-update-org'
const LOGO_KEY = `organizations/${ORG}/logo/3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d`

const saveOrganization = vi.fn(async (_data: Record<string, unknown>) => {})
const deleteAssetObject = vi.fn(async (_key: string) => {})

const requests = buildIdentityContext({
  db,
  identityPort: createInMemoryIdentityPort(),
  clock: () => new Date('2026-07-17T12:00:00Z'),
  idGen: () => '00000000-0000-4000-8000-000000000001',
  authSession: {
    setActiveOrganization: async () => {},
    updateOrganization: saveOrganization,
    currentOrganizationName: async () => null,
    verifyPassword: async () => false,
  },
  deleteAssetObject,
  sendEmail: async () => {},
  baseUrl: 'https://app.example.test',
  invitationExpiresInMs: 60_000,
  propertyNames: async () => [],
  logger: createMockLogger(),
  betaFeedbackHmacSecret: 'test-beta-feedback-pseudonym-secret',
  policy: { env: {}, propertyBelongsToOrganization: async () => true },
}).publicApi.requests

const admin: AuthContext = {
  userId: userId('user-build-update-org'),
  organizationId: organizationId(ORG),
  role: 'AccountAdmin',
}

beforeAll(async () => {
  await deleteTestOrganizations(db, [ORG])
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, logo, "createdAt")
    VALUES (${ORG}, 'Build Update Org', ${ORG}, ${identityAssetPath(LOGO_KEY)}, now())
  `)
})

beforeEach(() => {
  saveOrganization.mockReset()
  saveOrganization.mockResolvedValue(undefined)
  deleteAssetObject.mockClear()
})

afterAll(() => deleteTestOrganizations(db, [ORG]))

describe('requests.updateOrganization as built', () => {
  it('saves a removed logo as removed and frees the object it was', async () => {
    await requests.updateOrganization({ logo: null }, admin)

    expect(saveOrganization).toHaveBeenCalledExactlyOnceWith({ logo: null })
    expect(deleteAssetObject).toHaveBeenCalledExactlyOnceWith(LOGO_KEY)
  })

  it('keeps the object when the removal could not be saved', async () => {
    saveOrganization.mockRejectedValue(new Error('provider down'))

    await expect(requests.updateOrganization({ logo: null }, admin)).rejects.toThrow(
      'provider down',
    )

    expect(deleteAssetObject).not.toHaveBeenCalled()
  })

  it('frees nothing for an update that leaves the logo alone', async () => {
    await requests.updateOrganization({ name: 'Renamed' }, admin)

    expect(saveOrganization).toHaveBeenCalledExactlyOnceWith({ name: 'Renamed' })
    expect(deleteAssetObject).not.toHaveBeenCalled()
  })
})
