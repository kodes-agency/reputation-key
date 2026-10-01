import { createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { getDb } from '#/shared/db'
import { organizationId, portalId, propertyId, userId } from '#/shared/domain/ids'
import { createPortalAddressRepository } from './portal-address.repository'

const ORG = organizationId('org-portal-address-test')
const OTHER_ORG = organizationId('org-portal-address-other')
const PROPERTY = propertyId('df000000-0000-4000-8000-000000000001')
const PROPERTY_OTHER = propertyId('df000000-0000-4000-8000-000000000002')
const PORTAL = portalId('df000000-0000-4000-8000-000000000011')
const PORTAL_OTHER = portalId('df000000-0000-4000-8000-000000000012')
const TOKEN = 'df000000-0000-4000-8000-000000000021'
const TOKEN_OTHER = 'df000000-0000-4000-8000-000000000031'
const QR = 'df000000-0000-4000-8000-000000000041'
const NFC = 'df000000-0000-4000-8000-000000000042'
const QR_OTHER = 'df000000-0000-4000-8000-000000000051'
const NFC_OTHER = 'df000000-0000-4000-8000-000000000052'
const NOW = new Date('2026-09-10T12:00:00.000Z')
const MANAGER = userId('user-portal-address-manager')
let pool: Pool

const hash = (name: string) =>
  createHash('sha256').update(`portal-address-repository:${name}`).digest('hex')

async function seedToken(
  input: Readonly<{
    id: string
    org: string
    property: string
    portal: string
    identifier: string
    version?: number
    status?: 'active' | 'rotating' | 'revoked'
    sealed?: boolean
  }>,
) {
  const sealed = input.sealed ?? true
  await pool.query(
    `INSERT INTO portal_tokens (
       id, organization_id, property_id, portal_id, token_identifier, token_hash,
       encrypted_raw_token, address_encryption_key_version, version, status,
       issued_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
    [
      input.id,
      input.org,
      input.property,
      input.portal,
      input.identifier,
      hash(input.identifier),
      sealed ? `ciphertext-for-${input.identifier}` : null,
      sealed ? 3 : null,
      input.version ?? 1,
      input.status ?? 'active',
      NOW,
    ],
  )
}

async function seedMarkers(
  org: string,
  property: string,
  portal: string,
  token: string,
  ids: readonly [string, string],
  channels: readonly ('qr' | 'nfc')[] = ['qr', 'nfc'],
) {
  for (const [channel, id] of [
    ['qr', ids[0]],
    ['nfc', ids[1]],
  ] as const) {
    if (!channels.includes(channel)) continue
    await pool.query(
      `INSERT INTO portal_access_artifacts (
         id, organization_id, property_id, portal_id, portal_token_id, channel, status,
         published_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'published', now())`,
      [id, org, property, portal, token, channel],
    )
  }
}

async function clear() {
  for (const table of [
    'portal_address_downloads',
    'portal_access_artifacts',
    'portal_tokens',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id IN ($1, $2)`, [
      ORG,
      OTHER_ORG,
    ])
  }
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  for (const org of [ORG, OTHER_ORG]) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, NOW()) ON CONFLICT (id) DO NOTHING`,
      [org],
    )
  }
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'Address Property', 'address-property', 'UTC', NOW(), NOW()),
            ($2, $4, 'Address Property Other', 'address-property-other', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, PROPERTY_OTHER, ORG, OTHER_ORG],
  )
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, publication_state, created_at, updated_at)
     VALUES ($1, $3, $5::uuid, 'property', $5::text, 'Address Portal', 'address-portal', 'published', NOW(), NOW()),
            ($2, $4, $6::uuid, 'property', $6::text, 'Other Address Portal', 'address-portal-other', 'published', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PORTAL, PORTAL_OTHER, ORG, OTHER_ORG, PROPERTY, PROPERTY_OTHER],
  )
})

afterAll(async () => {
  await clear()
  await pool.query('DELETE FROM portals WHERE organization_id IN ($1, $2)', [
    ORG,
    OTHER_ORG,
  ])
  await pool.query('DELETE FROM properties WHERE id IN ($1, $2)', [
    PROPERTY,
    PROPERTY_OTHER,
  ])
  await deleteTestOrganizations(pool, [ORG, OTHER_ORG])
  await pool.end()
})

beforeEach(clear)

describe('portal address repository', () => {
  it('finds the live code with its sealed address and both markers', async () => {
    await seedToken({
      id: TOKEN,
      org: ORG,
      property: PROPERTY,
      portal: PORTAL,
      identifier: 'address-one',
    })
    await seedMarkers(ORG, PROPERTY, PORTAL, TOKEN, [QR, NFC])

    await expect(
      createPortalAddressRepository(getDb()).findRevealable(ORG, PORTAL),
    ).resolves.toEqual({
      tokenId: TOKEN,
      propertyId: PROPERTY,
      version: 1,
      issuedAt: NOW,
      sealed: { ciphertext: 'ciphertext-for-address-one', keyVersion: 3 },
      accessArtifactIds: { qr: QR, nfc: NFC },
    })
  })

  it('never crosses a tenant, whichever Portal id is asked for', async () => {
    await seedToken({
      id: TOKEN_OTHER,
      org: OTHER_ORG,
      property: PROPERTY_OTHER,
      portal: PORTAL_OTHER,
      identifier: 'address-other',
    })
    await seedMarkers(OTHER_ORG, PROPERTY_OTHER, PORTAL_OTHER, TOKEN_OTHER, [
      QR_OTHER,
      NFC_OTHER,
    ])
    const repo = createPortalAddressRepository(getDb())

    await expect(repo.findRevealable(ORG, PORTAL_OTHER)).resolves.toBeNull()
    await expect(repo.findRevealable(OTHER_ORG, PORTAL)).resolves.toBeNull()
    await expect(repo.findRevealable(OTHER_ORG, PORTAL_OTHER)).resolves.toMatchObject({
      tokenId: TOKEN_OTHER,
    })
  })

  it.each([
    ['holds no sealed address', { sealed: false }],
    ['was replaced', { status: 'rotating' as const, sealed: false }],
    ['was stopped', { status: 'revoked' as const, sealed: false }],
  ])('finds nothing for a code that %s', async (_label, state) => {
    await seedToken({
      id: TOKEN,
      org: ORG,
      property: PROPERTY,
      portal: PORTAL,
      identifier: 'address-one',
      ...state,
    })
    await seedMarkers(ORG, PROPERTY, PORTAL, TOKEN, [QR, NFC])

    await expect(
      createPortalAddressRepository(getDb()).findRevealable(ORG, PORTAL),
    ).resolves.toBeNull()
  })

  it('finds nothing when a marker is missing, because the URLs could not be rebuilt', async () => {
    await seedToken({
      id: TOKEN,
      org: ORG,
      property: PROPERTY,
      portal: PORTAL,
      identifier: 'address-one',
    })
    await seedMarkers(ORG, PROPERTY, PORTAL, TOKEN, [QR, NFC], ['qr'])

    await expect(
      createPortalAddressRepository(getDb()).findRevealable(ORG, PORTAL),
    ).resolves.toBeNull()
  })

  it('records a download for the live code and nothing for a stopped one', async () => {
    await seedToken({
      id: TOKEN,
      org: ORG,
      property: PROPERTY,
      portal: PORTAL,
      identifier: 'address-one',
    })
    const repo = createPortalAddressRepository(getDb())
    const input = {
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      tokenId: TOKEN,
      downloadedBy: MANAGER,
      purpose: 'download' as const,
      at: NOW,
    }

    await expect(repo.recordDownload(input)).resolves.toBe(true)
    const rows = await pool.query(
      `SELECT organization_id, portal_id, portal_token_id, downloaded_by, purpose, downloaded_at
       FROM portal_address_downloads`,
    )
    expect(rows.rows).toEqual([
      {
        organization_id: ORG,
        portal_id: PORTAL,
        portal_token_id: TOKEN,
        downloaded_by: MANAGER,
        purpose: 'download',
        downloaded_at: NOW,
      },
    ])

    await pool.query(
      `UPDATE portal_tokens SET status = 'revoked', encrypted_raw_token = NULL,
         address_encryption_key_version = NULL WHERE id = $1`,
      [TOKEN],
    )
    await expect(repo.recordDownload({ ...input, purpose: 'copy' })).resolves.toBe(false)
    expect((await pool.query('SELECT 1 FROM portal_address_downloads')).rowCount).toBe(1)
  })

  it("refuses to record a download against another tenant's code", async () => {
    await seedToken({
      id: TOKEN_OTHER,
      org: OTHER_ORG,
      property: PROPERTY_OTHER,
      portal: PORTAL_OTHER,
      identifier: 'address-other',
    })

    await expect(
      createPortalAddressRepository(getDb()).recordDownload({
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        tokenId: TOKEN_OTHER,
        downloadedBy: MANAGER,
        purpose: 'download',
        at: NOW,
      }),
    ).resolves.toBe(false)
    expect((await pool.query('SELECT 1 FROM portal_address_downloads')).rowCount).toBe(0)
  })

  it('refuses a sealed address on a code that is not active, and an unknown purpose', async () => {
    await expect(
      seedToken({
        id: TOKEN,
        org: ORG,
        property: PROPERTY,
        portal: PORTAL,
        identifier: 'address-one',
        status: 'rotating',
      }),
    ).rejects.toMatchObject({ constraint: 'portal_tokens_sealed_address_active_only' })

    await seedToken({
      id: TOKEN,
      org: ORG,
      property: PROPERTY,
      portal: PORTAL,
      identifier: 'address-two',
    })
    await expect(
      pool.query(
        `INSERT INTO portal_address_downloads
           (organization_id, property_id, portal_id, portal_token_id, downloaded_by,
            purpose, downloaded_at)
         VALUES ($1, $2, $3, $4, 'u', 'print', now())`,
        [ORG, PROPERTY, PORTAL, TOKEN],
      ),
    ).rejects.toMatchObject({ constraint: 'portal_address_downloads_purpose_valid' })
  })
})
