import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { organizationId, portalId } from '#/shared/domain/ids'
import { createPortalTokenRepository } from './portal-token.repository'
import { issueToken, rotateToken } from '../../domain/portal-token'

const ORG = organizationId('org-portal-token-test')
const OTHER_ORG = organizationId('org-portal-token-other')
const PROPERTY = 'de000000-0000-4000-8000-000000000001'
const PORTAL = portalId('de000000-0000-4000-8000-000000000011')
const NOW = new Date('2026-08-08T12:00:00.000Z')
let pool: Pool

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
     VALUES ($1, $2, 'Token Property', 'token-property', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, ORG],
  )
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, publication_state, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $4, 'Token Portal', 'token-portal', 'published', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PORTAL, ORG, PROPERTY, PROPERTY],
  )
})

afterAll(async () => {
  await pool.query('DELETE FROM portal_tokens WHERE organization_id IN ($1, $2)', [
    ORG,
    OTHER_ORG,
  ])
  await pool.query('DELETE FROM portals WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE id = $1', [PROPERTY])
  await pool.query('DELETE FROM organization WHERE id IN ($1, $2)', [ORG, OTHER_ORG])
  await pool.end()
})

beforeEach(async () => {
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
    tokenHash: 'a'.repeat(64),
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
          tokenHash: 'b'.repeat(64),
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
        tokenHash: 'b'.repeat(64),
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
        tokenHash: 'b'.repeat(64),
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
    expect(active).toEqual({ version: 1, issuedAt: NOW, gracePeriodEnds: null })

    const rotation = rotateToken(
      current,
      {
        id: 'de000000-0000-4000-8000-000000000024',
        tokenIdentifier: 'lookup-key-three',
        tokenHash: 'c'.repeat(64),
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
        tokenHash: 'd'.repeat(64),
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

    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, NOW),
    ).resolves.toEqual({
      version: 1,
      issuedAt: NOW,
      gracePeriodEnds: rotation.oldToken.gracePeriodEnds,
    })
    await expect(
      repo.findResolvableSummaryForPortal(ORG, PORTAL, new Date(NOW.getTime() + 60_001)),
    ).resolves.toBeNull()
  })
})
