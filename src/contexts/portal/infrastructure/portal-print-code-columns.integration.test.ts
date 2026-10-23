// What migration 0070 does against real PostgreSQL: the two print code hash
// columns of `portal_tokens` take what the codec stores, refuse any other form,
// and are unique only where a hash exists (ADR 0069).

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createPortalTokenCodec } from './adapters/portal-token-codec'

const CHANNELS = ['qr', 'nfc'] as const
type Channel = (typeof CHANNELS)[number]

const codec = createPortalTokenCodec({
  secret: 'portal-print-code-columns-secret-0123456789',
  randomBytes: (size) => Buffer.alloc(size, 7),
})

describe('portal_tokens print code hash columns (real PostgreSQL)', () => {
  let lease: TestLease
  const organizationId = `print-code-columns-${randomUUID()}`
  const propertyId = randomUUID()
  const portalId = randomUUID()
  let versions = 0

  const q = (text: string, values: readonly unknown[] = []) =>
    lease.pool.query(text, [...values])

  /** A code row, optionally carrying print code hashes, as the migration allows. */
  async function insertToken(
    hashes: Partial<Record<Channel, string | null>> = {},
  ): Promise<string> {
    const id = randomUUID()
    versions += 1
    await q(
      `INSERT INTO portal_tokens
         (id, organization_id, property_id, portal_id, token_identifier, token_hash,
          version, status, issued_at, qr_print_code_hash, nfc_print_code_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', now(), $8, $9)`,
      [
        id,
        organizationId,
        propertyId,
        portalId,
        id.replaceAll('-', '').slice(0, 24),
        id.replaceAll('-', '') + id.replaceAll('-', ''),
        versions,
        hashes.qr ?? null,
        hashes.nfc ?? null,
      ],
    )
    return id
  }

  const realHashes = () => {
    const derived = codec.derivePrintCodes({
      rawToken: codec.issue().rawToken,
      accessArtifactIds: { qr: randomUUID(), nfc: randomUUID() },
    })
    if (!derived) throw new Error('the codec did not derive print codes')
    return { qr: derived.qr.printCodeHash, nfc: derived.nfc.printCodeHash }
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    await q(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $1, $1, NOW())`,
      [organizationId],
    )
    await q(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Print code property', $3, 'UTC')`,
      [propertyId, organizationId, `print-code-${randomUUID()}`],
    )
    await q(
      `INSERT INTO portals
         (id, organization_id, property_id, entity_type, entity_id, name, slug)
       VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Print code portal', $4)`,
      [portalId, organizationId, propertyId, `print-code-portal-${randomUUID()}`],
    )
  })

  afterAll(async () => {
    if (!lease) return
    await q('DELETE FROM portal_tokens WHERE organization_id = $1', [organizationId])
    await q('DELETE FROM portals WHERE organization_id = $1', [organizationId])
    await q('DELETE FROM properties WHERE organization_id = $1', [organizationId])
    await deleteTestOrganizations(lease.pool, [organizationId])
    await lease.release()
  })

  it('lets a row exist with no hashes, as every row did before the migration', async () => {
    const id = await insertToken()
    const { rows } = await q(
      'SELECT qr_print_code_hash, nfc_print_code_hash FROM portal_tokens WHERE id = $1',
      [id],
    )
    expect(rows).toEqual([{ qr_print_code_hash: null, nfc_print_code_hash: null }])
  })

  it('stores what the codec derives and finds the row by either hash', async () => {
    const hashes = realHashes()
    const id = await insertToken(hashes)
    for (const channel of CHANNELS) {
      const { rows } = await q(
        `SELECT id FROM portal_tokens WHERE ${channel}_print_code_hash = $1`,
        [hashes[channel]],
      )
      expect(rows).toEqual([{ id }])
    }
  })

  it('finds nothing when the other channel hash is looked up in this column', async () => {
    const hashes = realHashes()
    await insertToken(hashes)
    const { rows } = await q(
      'SELECT id FROM portal_tokens WHERE qr_print_code_hash = $1',
      [hashes.nfc],
    )
    expect(rows).toEqual([])
  })

  it.each(CHANNELS)(
    'refuses a %s hash that is not 64 lowercase hex characters',
    async (channel) => {
      const good = realHashes()[channel]
      for (const bad of [
        '',
        good.slice(1),
        good.toUpperCase(),
        `${good.slice(1)}g`,
        `${good.slice(2)} 0`,
      ]) {
        await expect(insertToken({ [channel]: bad }), bad).rejects.toMatchObject({
          code: '23514',
          constraint: `portal_tokens_${channel}_print_code_hash_format`,
        })
      }
    },
  )

  it.each(CHANNELS)('refuses a %s hash longer than the column', async (channel) => {
    // varchar(64) stops it before the CHECK is reached.
    await expect(
      insertToken({ [channel]: `${realHashes()[channel]}0` }),
    ).rejects.toMatchObject({ code: '22001' })
  })

  it.each(CHANNELS)('refuses the same %s hash on two rows', async (channel) => {
    const hash = realHashes()[channel]
    await insertToken({ [channel]: hash })
    await expect(insertToken({ [channel]: hash })).rejects.toMatchObject({
      code: '23505',
      constraint: `portal_tokens_${channel}_print_code_hash_key`,
    })
  })

  it('does not compare rows that have no hash yet', async () => {
    await insertToken()
    await expect(insertToken()).resolves.toEqual(expect.any(String))
    await insertToken({ qr: realHashes().qr })
    await expect(insertToken({ nfc: realHashes().nfc })).resolves.toEqual(
      expect.any(String),
    )
  })

  it('fills a missing hash in place and keeps what is already there', async () => {
    const hashes = realHashes()
    const id = await insertToken({ qr: hashes.qr })
    await q(
      `UPDATE portal_tokens
          SET qr_print_code_hash = COALESCE(qr_print_code_hash, $2),
              nfc_print_code_hash = COALESCE(nfc_print_code_hash, $3)
        WHERE id = $1`,
      [id, realHashes().qr, hashes.nfc],
    )
    const { rows } = await q(
      'SELECT qr_print_code_hash, nfc_print_code_hash FROM portal_tokens WHERE id = $1',
      [id],
    )
    expect(rows).toEqual([
      { qr_print_code_hash: hashes.qr, nfc_print_code_hash: hashes.nfc },
    ])
  })
})
