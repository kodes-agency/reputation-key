import { createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { getDb } from '#/shared/db'
import { organizationId, portalId } from '#/shared/domain/ids'
import { createPortalTokenRepository } from './portal-token.repository'
import { issueToken, rotateToken } from '../../domain/portal-token'
import { seedPortalToken } from '../testing/portal-read-fixtures'

const ORG = organizationId('org-portal-token-test')
const OTHER_ORG = organizationId('org-portal-token-other')
const PROPERTY = 'de000000-0000-4000-8000-000000000001'
const PROPERTY_OTHER = 'de000000-0000-4000-8000-000000000002'
const PORTAL = portalId('de000000-0000-4000-8000-000000000011')
// The other tenant's own portal. A portal id arrives from the public URL
// while the organization id comes from the session, so a read that drops the
// organizationId conjunct is a straight IDOR on a printed guest token.
const PORTAL_OTHER = portalId('de000000-0000-4000-8000-000000000012')
const NOW = new Date('2026-08-08T12:00:00.000Z')
let pool: Pool

function fixtureTokenHash(name: string): string {
  return createHash('sha256').update(`portal-token-repository:${name}`).digest('hex')
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
     VALUES ($1, $3, 'Token Property', 'token-property', 'UTC', NOW(), NOW()),
            ($2, $4, 'Token Property Other', 'token-property-other', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, PROPERTY_OTHER, ORG, OTHER_ORG],
  )
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, publication_state, created_at, updated_at)
     VALUES ($1, $3, $5::uuid, 'property', $5::text, 'Token Portal', 'token-portal', 'published', NOW(), NOW()),
            ($2, $4, $6::uuid, 'property', $6::text, 'Other Tenant Portal', 'token-portal-other', 'published', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PORTAL, PORTAL_OTHER, ORG, OTHER_ORG, PROPERTY, PROPERTY_OTHER],
  )
})

afterAll(async () => {
  await pool.query(
    'DELETE FROM portal_access_artifacts WHERE organization_id IN ($1, $2)',
    [ORG, OTHER_ORG],
  )
  await pool.query('DELETE FROM portal_tokens WHERE organization_id IN ($1, $2)', [
    ORG,
    OTHER_ORG,
  ])
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

beforeEach(async () => {
  await pool.query(
    'DELETE FROM portal_access_artifacts WHERE organization_id IN ($1, $2)',
    [ORG, OTHER_ORG],
  )
  await pool.query('DELETE FROM portal_tokens WHERE organization_id IN ($1, $2)', [
    ORG,
    OTHER_ORG,
  ])
})

function makeToken() {
  return issueToken({
    id: 'de000000-0000-4000-8000-000000000021',
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    tokenIdentifier: 'lookup-key-one',
    tokenHash: fixtureTokenHash('primary-v1'),
    tokenKeyVersion: 1,
    version: 1,
    now: NOW,
  })
}

// The other tenant's own, legitimately-owned token. Distinct identifier and
// hash because both are globally unique indexes.
function makeOtherTenantToken() {
  return issueToken({
    id: 'de000000-0000-4000-8000-000000000031',
    organizationId: OTHER_ORG,
    propertyId: PROPERTY_OTHER,
    portalId: PORTAL_OTHER,
    tokenIdentifier: 'lookup-key-tenant-b',
    tokenHash: fixtureTokenHash('other-tenant-v1'),
    tokenKeyVersion: 1,
    version: 1,
    now: NOW,
  })
}

describe('portal token repository', () => {
  it('enforces the portal tenant FK', async () => {
    const token = makeToken()
    await seedPortalToken(getDb(), token)

    let insertionError: unknown
    try {
      await seedPortalToken(getDb(), {
        ...token,
        id: 'de000000-0000-4000-8000-000000000023',
        organizationId: OTHER_ORG,
        tokenIdentifier: 'lookup-key-other',
        tokenHash: fixtureTokenHash('invalid-tenant'),
      })
    } catch (error) {
      insertionError = error
    }
    expect(
      (insertionError as { cause?: { constraint?: unknown } } | undefined)?.cause
        ?.constraint,
    ).toBe('portal_tokens_portal_tenant_fk')
  })

  it('reports who made the live code, and nobody for a code that recorded no maker', async () => {
    const repo = createPortalTokenRepository(getDb())
    await seedPortalToken(getDb(), makeToken())
    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW),
    ).resolves.toMatchObject({ issuedBy: null })

    await pool.query('UPDATE portal_tokens SET issued_by = $1 WHERE portal_id = $2', [
      'user-georgi',
      PORTAL,
    ])

    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW),
    ).resolves.toMatchObject({ issuedBy: 'user-georgi' })
    await expect(
      repo.findResolvableSummariesForPortals(ORG, [PORTAL], NOW),
    ).resolves.toMatchObject([{ portalId: PORTAL, issuedBy: 'user-georgi' }])
  })

  // C2: the management token-status projection must agree with public token
  // resolution about what "live" means, state for state.
  it('summarises the portal token across its lifecycle', async () => {
    const repo = createPortalTokenRepository(getDb())

    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW),
    ).resolves.toBeNull()

    const current = makeToken()
    await seedPortalToken(getDb(), current)
    const active = await repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW)
    expect(active).toEqual({
      version: 1,
      issuedAt: NOW,
      gracePeriodEnds: null,
      hasPublishedAccessArtifact: false,
      addressKeyVersion: null,
      issuedBy: null,
    })

    const rotation = rotateToken(
      current,
      {
        id: 'de000000-0000-4000-8000-000000000024',
        tokenIdentifier: 'lookup-key-three',
        tokenHash: fixtureTokenHash('summary-v2'),
        tokenKeyVersion: 1,
        version: 2,
      },
      60_000,
      NOW,
    )
    if (!('oldToken' in rotation)) throw new Error('rotation failed')
    await seedPortalToken(getDb(), rotation.oldToken)
    await seedPortalToken(getDb(), rotation.newToken)

    // Inside the grace window both tokens resolve; the newest one governs.
    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW),
    ).resolves.toMatchObject({ version: 2 })

    await pool.query(
      "UPDATE portal_tokens SET status = 'revoked', grace_period_ends = NULL WHERE organization_id = $1 AND portal_id = $2",
      [ORG, PORTAL],
    )
    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW),
    ).resolves.toBeNull()
  })

  it('counts a token inside its grace window and drops it once closed', async () => {
    const repo = createPortalTokenRepository(getDb())
    const rotation = rotateToken(
      makeToken(),
      {
        id: 'de000000-0000-4000-8000-000000000025',
        tokenIdentifier: 'lookup-key-four',
        tokenHash: fixtureTokenHash('grace-v2'),
        tokenKeyVersion: 1,
        version: 2,
      },
      60_000,
      NOW,
    )
    if (!('oldToken' in rotation)) throw new Error('rotation failed')
    // Persist only the outgoing token: an already-printed code still honoured
    // for the rest of its grace window.
    await seedPortalToken(getDb(), rotation.oldToken)

    await expect(repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW)).resolves.toEqual({
      version: 1,
      issuedAt: NOW,
      gracePeriodEnds: rotation.oldToken.gracePeriodEnds,
      hasPublishedAccessArtifact: false,
      addressKeyVersion: null,
      issuedBy: null,
    })
    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, new Date(NOW.getTime() + 60_001)),
    ).resolves.toBeNull()
  })

  it('reports the outgoing code grace end while the newer code is current', async () => {
    const repo = createPortalTokenRepository(getDb())
    const current = makeToken()
    await seedPortalToken(getDb(), current)
    const rotation = rotateToken(
      current,
      {
        id: 'de000000-0000-4000-8000-000000000026',
        tokenIdentifier: 'lookup-key-five',
        tokenHash: fixtureTokenHash('planned-v2'),
        tokenKeyVersion: 1,
        version: 2,
      },
      60_000,
      NOW,
    )
    if (!('oldToken' in rotation)) throw new Error('rotation failed')
    await seedPortalToken(getDb(), rotation.oldToken)
    await seedPortalToken(getDb(), rotation.newToken)

    // The current token is v2 and has no grace of its own: the window that
    // matters to a reader is the one the printed (v1) code is still inside.
    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW),
    ).resolves.toMatchObject({
      version: 2,
      gracePeriodEnds: rotation.oldToken.gracePeriodEnds,
    })
    // Once the window closes there is nothing left to report.
    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, new Date(NOW.getTime() + 60_001)),
    ).resolves.toMatchObject({ version: 2, gracePeriodEnds: null })
  })

  it('reports published access-artifact readiness and permits a retired channel marker to be replaced', async () => {
    const repo = createPortalTokenRepository(getDb())
    const token = makeToken()
    await seedPortalToken(getDb(), token)

    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW),
    ).resolves.toMatchObject({ hasPublishedAccessArtifact: false })

    await pool.query(
      `INSERT INTO portal_access_artifacts
         (id, organization_id, property_id, portal_id, portal_token_id, channel,
          status, published_at, retired_at)
       VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid, 'qr', 'published', $6, NULL)`,
      ['de000000-0000-4000-8000-000000000041', ORG, PROPERTY, PORTAL, token.id, NOW],
    )
    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW),
    ).resolves.toMatchObject({ hasPublishedAccessArtifact: true })

    const replacedAt = new Date(NOW.getTime() + 1_000)
    await pool.query(
      `UPDATE portal_access_artifacts
       SET status = 'retired', retired_at = $2
       WHERE id = $1`,
      ['de000000-0000-4000-8000-000000000041', replacedAt],
    )
    await pool.query(
      `INSERT INTO portal_access_artifacts
         (id, organization_id, property_id, portal_id, portal_token_id, channel,
          status, published_at, retired_at)
       VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid, 'qr', 'published', $6, NULL)`,
      [
        'de000000-0000-4000-8000-000000000042',
        ORG,
        PROPERTY,
        PORTAL,
        token.id,
        replacedAt,
      ],
    )

    const history = await pool.query(
      `SELECT status FROM portal_access_artifacts
       WHERE portal_token_id = $1::uuid AND channel = 'qr'
       ORDER BY published_at`,
      [token.id],
    )
    expect(history.rows).toEqual([{ status: 'retired' }, { status: 'published' }])
    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, replacedAt),
    ).resolves.toMatchObject({ hasPublishedAccessArtifact: true })

    await expect(
      pool.query(
        `INSERT INTO portal_access_artifacts
           (id, organization_id, property_id, portal_id, portal_token_id, channel,
            status, published_at, retired_at)
         VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid, 'qr', 'published', $6, NULL)`,
        [
          'de000000-0000-4000-8000-000000000043',
          ORG,
          PROPERTY,
          PORTAL,
          token.id,
          new Date(replacedAt.getTime() + 1_000),
        ],
      ),
    ).rejects.toMatchObject({ constraint: 'portal_access_artifacts_token_channel_key' })
  })
})

// Management reads must refuse a Portal id belonging to another Organization.
describe('portal token repository — tenant isolation', () => {
  // Plants a REAL active token owned by OTHER_ORG on OTHER_ORG's own portal.
  async function seedOtherTenantToken() {
    const repo = createPortalTokenRepository(getDb())
    const other = makeOtherTenantToken()
    await seedPortalToken(getDb(), other)
    const { rows } = await pool.query(
      `SELECT organization_id, portal_id, status FROM portal_tokens WHERE id = $1`,
      [other.id],
    )
    expect(rows).toEqual([
      { organization_id: OTHER_ORG, portal_id: PORTAL_OTHER, status: 'active' },
    ])
    return { repo, other }
  }

  it('findLatestForPortal does not disclose another tenant token for a known portal id', async () => {
    const { repo, other } = await seedOtherTenantToken()

    // The caller knows the portal id but belongs to ORG. Leaking here would
    // hand over tokenHash + tokenIdentifier, i.e. the portal's live secret.
    await expect(repo.findLatestForPortal(ORG, PORTAL_OTHER)).resolves.toBeNull()
    // The owning tenant still gets it, so this is scoping and not a dead read.
    await expect(
      repo.findLatestForPortal(OTHER_ORG, PORTAL_OTHER),
    ).resolves.toMatchObject({ id: other.id, tokenHash: other.tokenHash })
  })
})
