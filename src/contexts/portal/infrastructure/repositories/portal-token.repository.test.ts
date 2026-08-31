import { createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { getDb } from '#/shared/db'
import { organizationId, portalId } from '#/shared/domain/ids'
import { createPortalTokenRepository } from './portal-token.repository'
import { issueToken, rotateToken } from '../../domain/portal-token'

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
  it('resolves only a matching active digest', async () => {
    const repo = createPortalTokenRepository(getDb())
    const token = makeToken()
    await repo.insert(token)

    await expect(
      repo.findResolvableByDigest(
        {
          tokenIdentifier: token.tokenIdentifier,
          tokenHash: token.tokenHash,
          tokenKeyVersion: token.tokenKeyVersion,
        },
        NOW,
      ),
    ).resolves.toMatchObject({ id: token.id, status: 'active' })
    await expect(
      repo.findResolvableByDigest(
        {
          tokenIdentifier: token.tokenIdentifier,
          tokenHash: fixtureTokenHash('non-matching-digest'),
          tokenKeyVersion: 1,
        },
        NOW,
      ),
    ).resolves.toBeNull()
  })

  it('persists rotation atomically and honors the old-token grace boundary', async () => {
    const repo = createPortalTokenRepository(getDb())
    const current = makeToken()
    await repo.insert(current)
    const rotation = rotateToken(
      current,
      {
        id: 'de000000-0000-4000-8000-000000000022',
        tokenIdentifier: 'lookup-key-two',
        tokenHash: fixtureTokenHash('primary-v2'),
        tokenKeyVersion: 1,
        version: 2,
      },
      60_000,
      NOW,
    )
    if (!('oldToken' in rotation)) throw new Error('rotation failed')
    await repo.saveRotation(rotation)

    const oldDigest = {
      tokenIdentifier: current.tokenIdentifier,
      tokenHash: current.tokenHash,
      tokenKeyVersion: current.tokenKeyVersion,
    }
    await expect(repo.findResolvableByDigest(oldDigest, NOW)).resolves.toMatchObject({
      status: 'rotating',
    })
    await expect(
      repo.findResolvableByDigest(oldDigest, new Date(NOW.getTime() + 60_001)),
    ).resolves.toBeNull()
    await expect(
      repo.findResolvableByDigest(
        {
          tokenIdentifier: rotation.newToken.tokenIdentifier,
          tokenHash: rotation.newToken.tokenHash,
          tokenKeyVersion: rotation.newToken.tokenKeyVersion,
        },
        new Date(NOW.getTime() + 60_001),
      ),
    ).resolves.toMatchObject({ status: 'active', version: 2 })
  })

  it('revokes all active/grace tokens and enforces the portal tenant FK', async () => {
    const repo = createPortalTokenRepository(getDb())
    const token = makeToken()
    await repo.insert(token)
    await expect(
      repo.revokeForPortal({
        organizationId: ORG,
        portalId: PORTAL,
        revokedBy: 'owner',
        reason: 'printed code lost',
        at: NOW,
      }),
    ).resolves.toBe(1)
    await expect(
      repo.findResolvableByDigest(
        {
          tokenIdentifier: token.tokenIdentifier,
          tokenHash: token.tokenHash,
          tokenKeyVersion: token.tokenKeyVersion,
        },
        NOW,
      ),
    ).resolves.toBeNull()

    let insertionError: unknown
    try {
      await repo.insert({
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

  // C2: the management token-status projection must agree with public token
  // resolution about what "live" means, state for state.
  it('summarises the portal token across its lifecycle', async () => {
    const repo = createPortalTokenRepository(getDb())

    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW),
    ).resolves.toBeNull()

    const current = makeToken()
    await repo.insert(current)
    const active = await repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW)
    expect(active).toEqual({
      version: 1,
      issuedAt: NOW,
      gracePeriodEnds: null,
      hasPublishedAccessArtifact: false,
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
    await repo.saveRotation(rotation)

    // Inside the grace window both tokens resolve; the newest one governs.
    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW),
    ).resolves.toMatchObject({ version: 2 })

    await repo.revokeForPortal({
      organizationId: ORG,
      portalId: PORTAL,
      revokedBy: 'owner',
      reason: 'leaked link',
      at: NOW,
    })
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
    await repo.insert(rotation.oldToken)

    await expect(repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW)).resolves.toEqual({
      version: 1,
      issuedAt: NOW,
      gracePeriodEnds: rotation.oldToken.gracePeriodEnds,
      hasPublishedAccessArtifact: false,
    })
    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, new Date(NOW.getTime() + 60_001)),
    ).resolves.toBeNull()
  })

  it('reports legacy-address readiness and permits a retired channel marker to be replaced', async () => {
    const repo = createPortalTokenRepository(getDb())
    const token = makeToken()
    await repo.insert(token)

    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW),
    ).resolves.toMatchObject({ hasPublishedAccessArtifact: false })
    await expect(repo.listAccessArtifactReadinessGaps(NOW, [ORG])).resolves.toEqual([
      {
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        tokenVersion: 1,
        tokenStatus: 'active',
        issuedAt: NOW,
        gracePeriodEnds: null,
      },
    ])

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
    await expect(repo.listAccessArtifactReadinessGaps(NOW, [ORG])).resolves.toEqual([])

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

// ── Tenant isolation ─────────────────────────────────────────────────
// NON-NEGOTIABLE. Before this block the file passed with all three of the
// repository's `organizationId` conjuncts removed, because no token was ever
// seeded for a second tenant. `portal_tokens.portal_id` is unique per portal
// and the composite FK ties (organization_id, portal_id) together, so the
// conjunct is redundant for a caller that passes a COHERENT pair — its whole
// job is to refuse an INCOHERENT one, i.e. a portal id lifted from a public
// URL combined with the attacker's own session organization. That is what
// these tests exercise.
//
// Note: findResolvableByDigest deliberately has no tenant conjunct. It is the
// public guest resolution path where the token itself is the capability, so
// there is nothing here to assert about it.
describe('portal token repository — tenant isolation', () => {
  // Plants a REAL active token owned by OTHER_ORG on OTHER_ORG's own portal.
  async function seedOtherTenantToken() {
    const repo = createPortalTokenRepository(getDb())
    const other = makeOtherTenantToken()
    await repo.insert(other)
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

  it('revokeForPortal cannot revoke another tenant live token', async () => {
    const { repo, other } = await seedOtherTenantToken()

    await expect(
      repo.revokeForPortal({
        organizationId: ORG,
        portalId: PORTAL_OTHER,
        revokedBy: 'attacker',
        reason: 'cross tenant revocation attempt',
        at: NOW,
      }),
    ).resolves.toBe(0)

    const { rows } = await pool.query(
      `SELECT status, revoked_at, revoked_by FROM portal_tokens WHERE id = $1`,
      [other.id],
    )
    expect(rows).toEqual([{ status: 'active', revoked_at: null, revoked_by: null }])

    // The owning tenant can revoke it, so the refusal above was tenant scoping.
    await expect(
      repo.revokeForPortal({
        organizationId: OTHER_ORG,
        portalId: PORTAL_OTHER,
        revokedBy: 'owner',
        reason: 'printed code lost',
        at: NOW,
      }),
    ).resolves.toBe(1)
  })

  it('saveRotation cannot rotate another tenant token', async () => {
    const { repo, other } = await seedOtherTenantToken()

    // A rotation aimed at the other tenant's row, presented under ORG.
    const hijack = rotateToken(
      { ...other, organizationId: ORG, propertyId: PROPERTY },
      {
        id: 'de000000-0000-4000-8000-000000000032',
        tokenIdentifier: 'lookup-key-hijack',
        tokenHash: fixtureTokenHash('tenant-rotation-attempt'),
        tokenKeyVersion: 1,
        version: 2,
      },
      60_000,
      NOW,
    )
    if (!('oldToken' in hijack)) throw new Error('fixture: rotation not constructed')

    await expect(repo.saveRotation(hijack)).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'token_unavailable',
    })
    const untouched = await pool.query(
      `SELECT status, version, grace_period_ends FROM portal_tokens WHERE id = $1`,
      [other.id],
    )
    expect(untouched.rows).toEqual([
      { status: 'active', version: 1, grace_period_ends: null },
    ])
    const smuggled = await pool.query(
      `SELECT id FROM portal_tokens WHERE token_identifier = 'lookup-key-hijack'`,
    )
    expect(smuggled.rows).toEqual([])

    // The owning tenant rotates the same row successfully.
    const legit = rotateToken(
      other,
      {
        id: 'de000000-0000-4000-8000-000000000033',
        tokenIdentifier: 'lookup-key-tenant-b2',
        tokenHash: fixtureTokenHash('other-tenant-v2'),
        tokenKeyVersion: 1,
        version: 2,
      },
      60_000,
      NOW,
    )
    if (!('oldToken' in legit)) throw new Error('fixture: rotation not constructed')
    await repo.saveRotation(legit)
    await expect(
      repo.findLatestForPortal(OTHER_ORG, PORTAL_OTHER),
    ).resolves.toMatchObject({ version: 2, status: 'active' })
  })
})
