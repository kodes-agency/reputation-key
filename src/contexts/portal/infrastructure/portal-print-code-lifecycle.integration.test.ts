// The life of a code's print codes on real PostgreSQL (ADR 0069 decisions 6 and 7).
//
// Issue and replace store both keyed hashes with the new row in one transaction;
// a refused hash rolls the command back as the typed `print_code_collision`; and
// "Download again" fills what an older code lacks, vouches only for a hash it can
// derive, and never fails because of one. The real use cases run over the real
// stores, the real cipher and the real codec; only the problem reporter and, in
// two tests, the fill are watched or made to fail.

import { randomBytes, randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { getDb } from '#/shared/db'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import type { PortalAddressFormat } from '../application/portal-address-urls'
import type { PortalAddressRepository } from '../application/ports/portal-address.repository'
import type { PortalTokenCodec } from '../application/ports/portal-token-codec.port'
import type { PrintCodeProblem } from '../application/ports/print-code-reporter.port'
import { issuePortalToken } from '../application/use-cases/issue-portal-token'
import { revealPortalAddress } from '../application/use-cases/reveal-portal-address'
import { rotatePortalToken } from '../application/use-cases/rotate-portal-token'
import { createPortalAddressCipher } from './adapters/portal-address-cipher'
import { createPortalAddressRepository } from './repositories/portal-address.repository'
import { createPortalRepository } from './repositories/portal.repository'
import { createPortalTokenRepository } from './repositories/portal-token.repository'
import { createAtomicPortalCommandStore } from './portal-command-store'
import { testPortalTokenCodec } from './testing/portal-token-codec-fixture'

const ORG = organizationId('org-print-lifecycle-000000000001')
const OTHER_ORG = organizationId('org-print-lifecycle-000000000002')
const NOW = new Date('2026-10-25T09:00:00.000Z')
const KEYRING = `1:${'cd'.repeat(32)}`
const ADDRESS: PortalAddressFormat = {
  appOrigin: 'https://app.example.test',
  printOrigin: 'https://ap.example.test',
  printCodesEnabled: true,
}
const staffPublicApi = {
  getAccessiblePropertyIds: async () => null,
} as unknown as StaffPublicApi

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'portal_address_downloads',
    'portal_access_artifacts',
    'portal_tokens',
    'outbox_events',
    'portals',
    'properties',
  ],
})

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

const cipher = createPortalAddressCipher({
  keyring: KEYRING,
  generateIv: () => randomBytes(12),
})

/** A Portal in its own Property, last changed an hour ago. */
async function seedPortal(org: string = ORG) {
  const scope = { org, property: randomUUID(), portal: randomUUID() }
  const slug = `print-${scope.portal.slice(0, 8)}`
  const earlier = new Date(NOW.getTime() - 60 * 60 * 1000)
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Print code property', $3, 'UTC')`,
    [scope.property, org, slug],
  )
  await getPool().query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id,
                          name, slug, publication_state, theme, created_by, created_at,
                          updated_at)
     VALUES ($1, $2, $3, 'property', $4, 'Print code portal', $5, 'published',
             '{"primaryColor":"#6366F1"}'::jsonb, 'manager-print-code', $6, $6)`,
    [scope.portal, org, scope.property, scope.property, slug, earlier],
  )
  return { ...scope, id: portalId(scope.portal), propertyId: propertyId(scope.property) }
}

type Seeded = Awaited<ReturnType<typeof seedPortal>>

type Wiring = Readonly<{
  codec?: PortalTokenCodec
  keyring?: boolean
  address?: PortalAddressFormat
  addressRepo?: (inner: PortalAddressRepository) => PortalAddressRepository
}>

/** The use cases over the real adapters, with the problems they report collected. */
function wire(options: Wiring = {}) {
  const db = getDb()
  const portalRepo = createPortalRepository(db)
  const portalTokenRepo = createPortalTokenRepository(db)
  const commandStore = createAtomicPortalCommandStore(db)
  const codec = options.codec ?? testPortalTokenCodec()
  const addressCipher = options.keyring === false ? null : cipher
  const reported: PrintCodeProblem[] = []
  const reportPrintCodeProblem = (problem: PrintCodeProblem) => {
    reported.push(problem)
  }
  const address = options.address ?? ADDRESS
  const innerAddressRepo = createPortalAddressRepository(db)
  const common = {
    portalRepo,
    portalTokenRepo,
    staffPublicApi,
    commandStore,
    tokenCodec: codec,
    addressCipher,
    reportPrintCodeProblem,
    idGen: randomUUID,
    clock: () => NOW,
    address,
  }
  return {
    reported,
    codec,
    ctx: buildTestAuthContext({ organizationId: ORG }),
    issue: issuePortalToken(common),
    rotate: rotatePortalToken({
      ...common,
      defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
    }),
    reveal: revealPortalAddress({
      portalRepo,
      staffPublicApi,
      portalAddressRepo: options.addressRepo?.(innerAddressRepo) ?? innerAddressRepo,
      addressCipher,
      tokenCodec: codec,
      reportPrintCodeProblem,
      clock: () => NOW,
      address,
    }),
    addressRepo: innerAddressRepo,
  }
}

type Row = Readonly<{
  id: string
  status: string
  version: number
  qr: string | null
  nfc: string | null
}>

const rowsOf = async (portal: Seeded): Promise<readonly Row[]> =>
  (
    await getPool().query<Row>(
      `SELECT id, status, version, qr_print_code_hash AS qr, nfc_print_code_hash AS nfc
       FROM portal_tokens WHERE portal_id = $1 ORDER BY version`,
      [portal.portal],
    )
  ).rows

const artifactIdsOf = async (tokenId: string) => {
  const { rows } = await getPool().query<{ id: string; channel: 'qr' | 'nfc' }>(
    'SELECT id, channel FROM portal_access_artifacts WHERE portal_token_id = $1',
    [tokenId],
  )
  const byChannel = (channel: 'qr' | 'nfc') =>
    rows.find((row) => row.channel === channel)?.id
  return { qr: byChannel('qr') ?? '', nfc: byChannel('nfc') ?? '' }
}

const HASH = /^[0-9a-f]{64}$/u

describe.sequential(
  'issue and replace store the print code hashes (real PostgreSQL)',
  () => {
    it('stores both hashes with a new code, the ones its address and markers derive', async () => {
      const portal = await seedPortal()
      const { issue, ctx, codec } = wire()

      const issued = await issue({ portalId: portal.id }, ctx)

      const [row] = await rowsOf(portal)
      expect(row).toMatchObject({ status: 'active', version: 1 })
      const derived = codec.derivePrintCodes({
        rawToken: issued.rawToken,
        accessArtifactIds: await artifactIdsOf(row?.id ?? ''),
      })
      expect(row?.qr).toBe(derived?.qr.printCodeHash)
      expect(row?.nfc).toBe(derived?.nfc.printCodeHash)
      expect(row?.qr).toMatch(HASH)
      expect(row?.nfc).toMatch(HASH)
      expect(row?.qr).not.toBe(row?.nfc)
    })

    it('stores the hashes whether or not a keyring is configured', async () => {
      const portal = await seedPortal()
      const { issue, ctx } = wire({ keyring: false })

      const issued = await issue({ portalId: portal.id }, ctx)

      expect(issued.addressRecoverable).toBe(false)
      const [row] = await rowsOf(portal)
      expect(row?.qr).toMatch(HASH)
      expect(row?.nfc).toMatch(HASH)
    })

    it('looks a printed code up by the hash that was stored for it', async () => {
      const portal = await seedPortal()
      const { issue, ctx, codec } = wire()

      const issued = await issue({ portalId: portal.id }, ctx)

      const [row] = await rowsOf(portal)
      const printCode = issued.publicUrls.qr.split('/p/')[1] ?? ''
      expect(printCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/u)
      expect(codec.digest(printCode)).toEqual({ kind: 'short', printCodeHash: row?.qr })
      expect(codec.digest(issued.publicUrls.nfc.split('/p/')[1] ?? '')).toEqual({
        kind: 'short',
        printCodeHash: row?.nfc,
      })
    })

    it('gives a replacement its own two hashes and leaves the outgoing code its own', async () => {
      const portal = await seedPortal()
      const { issue, rotate, ctx } = wire()
      await issue({ portalId: portal.id }, ctx)
      const [before] = await rowsOf(portal)

      await rotate({ portalId: portal.id }, ctx)

      const [outgoing, incoming] = await rowsOf(portal)
      expect(outgoing).toMatchObject({ id: before?.id, status: 'rotating' })
      expect(outgoing?.qr).toBe(before?.qr)
      expect(outgoing?.nfc).toBe(before?.nfc)
      expect(incoming).toMatchObject({ status: 'active', version: 2 })
      expect(incoming?.qr).toMatch(HASH)
      expect(incoming?.nfc).toMatch(HASH)
      const all = [outgoing?.qr, outgoing?.nfc, incoming?.qr, incoming?.nfc]
      expect(new Set(all).size).toBe(4)
    })

    it('keeps the print codes out of the events and the download record it commits', async () => {
      const portal = await seedPortal()
      const { issue, rotate, reveal, ctx } = wire()
      const issued = await issue({ portalId: portal.id }, ctx)
      const rotated = await rotate({ portalId: portal.id }, ctx)
      await reveal({ portalId: portal.id, purpose: 'download' }, ctx)

      const rows = await rowsOf(portal)
      const persisted = JSON.stringify([
        (
          await getPool().query(
            'SELECT * FROM outbox_events WHERE organization_id = $1',
            [ORG],
          )
        ).rows,
        (
          await getPool().query(
            'SELECT * FROM portal_address_downloads WHERE organization_id = $1',
            [ORG],
          )
        ).rows,
      ])
      const secrets = [
        issued.rawToken,
        rotated.rawToken,
        ...[issued, rotated].flatMap((made) => [
          made.publicUrls.qr.split('/p/')[1],
          made.publicUrls.nfc.split('/p/')[1],
        ]),
        ...rows.flatMap((row) => [row.qr, row.nfc]),
      ]
      expect(secrets.filter(Boolean)).toHaveLength(10)
      for (const secret of secrets) expect(persisted).not.toContain(String(secret))
    })
  },
)

/** A codec that derives another code's hashes, so the unique index refuses them. */
const collidingCodec = (
  base: PortalTokenCodec,
  taken: Readonly<{ qr: string; nfc: string }>,
): PortalTokenCodec => ({
  ...base,
  derivePrintCodes: (input) => {
    const own = base.derivePrintCodes(input)
    if (own === null) return null
    return {
      qr: { ...own.qr, printCodeHash: taken.qr },
      nfc: { ...own.nfc, printCodeHash: taken.nfc },
    }
  },
})

describe.sequential('a refused hash is a typed refusal with nothing written', () => {
  it('refuses an issue whose hash is taken, reports it, and leaves no code, marker or fact', async () => {
    const first = await seedPortal()
    const second = await seedPortal()
    const { issue, ctx, codec } = wire()
    await issue({ portalId: first.id }, ctx)
    const [taken] = await rowsOf(first)
    const clash = wire({
      codec: collidingCodec(codec, { qr: taken?.qr ?? '', nfc: taken?.nfc ?? '' }),
    })
    const outboxBefore = await getPool().query(
      'SELECT count(*)::int AS n FROM outbox_events',
    )

    await expect(clash.issue({ portalId: second.id }, ctx)).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'print_code_collision',
    })

    expect(await rowsOf(second)).toEqual([])
    const markers = await getPool().query(
      'SELECT count(*)::int AS n FROM portal_access_artifacts WHERE portal_id = $1',
      [second.portal],
    )
    expect(markers.rows[0]?.n).toBe(0)
    const outboxAfter = await getPool().query(
      'SELECT count(*)::int AS n FROM outbox_events',
    )
    expect(outboxAfter.rows[0]?.n).toBe(outboxBefore.rows[0]?.n)
    expect(clash.reported).toEqual(['collision'])
  })

  it('refuses a replacement whose hash is taken and leaves the outgoing code active', async () => {
    const first = await seedPortal()
    const second = await seedPortal()
    const { issue, ctx, codec } = wire()
    await issue({ portalId: first.id }, ctx)
    await issue({ portalId: second.id }, ctx)
    const [taken] = await rowsOf(first)
    const [before] = await rowsOf(second)
    const clash = wire({
      codec: collidingCodec(codec, { qr: taken?.qr ?? '', nfc: taken?.nfc ?? '' }),
    })

    await expect(clash.rotate({ portalId: second.id }, ctx)).rejects.toMatchObject({
      code: 'print_code_collision',
    })

    expect(await rowsOf(second)).toEqual([before])
    expect(clash.reported).toEqual(['collision'])
  })
})

/** Marks the code as one made before print codes existed: no hashes stored. */
const forgetHashes = (portal: Seeded) =>
  getPool().query(
    `UPDATE portal_tokens SET qr_print_code_hash = NULL, nfc_print_code_hash = NULL
     WHERE portal_id = $1`,
    [portal.portal],
  )

describe.sequential(
  'Download again vouches for the print codes (real PostgreSQL)',
  () => {
    it('hands back the short addresses the code was made with and writes no hash', async () => {
      const portal = await seedPortal()
      const { issue, reveal, ctx, reported } = wire()
      const issued = await issue({ portalId: portal.id }, ctx)
      const before = await rowsOf(portal)

      const revealed = await reveal({ portalId: portal.id, purpose: 'download' }, ctx)

      expect(revealed.publicUrls).toEqual(issued.publicUrls)
      expect(revealed.publicUrls.direct).toBe(
        `https://app.example.test/p/${issued.rawToken}`,
      )
      expect(await rowsOf(portal)).toEqual(before)
      expect(reported).toEqual([])
    })

    it('fills the hashes of a code that had none, and the same code comes back every time', async () => {
      const portal = await seedPortal()
      const { issue, reveal, ctx, reported } = wire()
      const issued = await issue({ portalId: portal.id }, ctx)
      const original = await rowsOf(portal)
      await forgetHashes(portal)

      const first = await reveal({ portalId: portal.id, purpose: 'download' }, ctx)
      const filled = await rowsOf(portal)
      const second = await reveal({ portalId: portal.id, purpose: 'download' }, ctx)

      expect(first.publicUrls).toEqual(issued.publicUrls)
      expect(second.publicUrls).toEqual(issued.publicUrls)
      expect(filled).toEqual(original)
      expect(await rowsOf(portal)).toEqual(original)
      expect(reported).toEqual([])
    })

    it('prints the long address and reports a mismatch when a stored hash differs', async () => {
      const portal = await seedPortal()
      const { issue, reveal, ctx, reported } = wire()
      const issued = await issue({ portalId: portal.id }, ctx)
      const [row] = await rowsOf(portal)
      await getPool().query(
        'UPDATE portal_tokens SET qr_print_code_hash = $2 WHERE id = $1',
        [row?.id, 'e'.repeat(64)],
      )

      const revealed = await reveal({ portalId: portal.id, purpose: 'download' }, ctx)

      expect(revealed.publicUrls.qr).toBe(
        `https://app.example.test/p/${issued.rawToken}?accessArtifact=${(await artifactIdsOf(row?.id ?? '')).qr}`,
      )
      expect(revealed.publicUrls.nfc).toBe(issued.publicUrls.nfc)
      expect(reported).toEqual(['derive_mismatch'])
    })

    it('shows the long address and reports a collision when the derived hash is held by another code', async () => {
      const holder = await seedPortal()
      const portal = await seedPortal()
      const { issue, reveal, ctx, reported } = wire()
      await issue({ portalId: holder.id }, ctx)
      const issued = await issue({ portalId: portal.id }, ctx)
      const [held] = await rowsOf(holder)
      // The other code's QR hash is the one this code's reveal would derive, as if
      // the two codes had collided: filling it is refused by the unique index.
      await forgetHashes(portal)
      const { codec } = wire()
      const [own] = await rowsOf(portal)
      const derived = codec.derivePrintCodes({
        rawToken: issued.rawToken,
        accessArtifactIds: await artifactIdsOf(own?.id ?? ''),
      })
      await getPool().query(
        'UPDATE portal_tokens SET qr_print_code_hash = $2 WHERE id = $1',
        [held?.id, derived?.qr.printCodeHash],
      )

      const revealed = await reveal({ portalId: portal.id, purpose: 'download' }, ctx)

      expect(revealed.publicUrls.qr).toContain('?accessArtifact=')
      expect(revealed.publicUrls.nfc).toContain('?accessArtifact=')
      expect(reported).toEqual(['collision'])
      expect((await rowsOf(portal))[0]).toMatchObject({ qr: null, nfc: null })
    })

    it('never fails the reveal because a fill failed, and still records the download', async () => {
      const portal = await seedPortal()
      const failing = wire({
        addressRepo: (inner) => ({
          ...inner,
          fillPrintCodeHashes: async () => {
            throw new Error('canceling statement due to lock timeout')
          },
        }),
      })
      const issued = await failing.issue({ portalId: portal.id }, failing.ctx)
      await forgetHashes(portal)

      const revealed = await failing.reveal(
        { portalId: portal.id, purpose: 'download' },
        failing.ctx,
      )

      expect(revealed.publicUrls.qr).toContain('?accessArtifact=')
      expect(revealed.publicUrls.direct).toBe(
        `https://app.example.test/p/${issued.rawToken}`,
      )
      expect(failing.reported).toEqual(['fill_failed'])
      const downloads = await getPool().query(
        'SELECT count(*)::int AS n FROM portal_address_downloads WHERE portal_id = $1',
        [portal.portal],
      )
      expect(downloads.rows[0]?.n).toBe(1)
    })

    it('fills only the hashes a code is missing, and never overwrites one that is there', async () => {
      const portal = await seedPortal()
      const { issue, ctx, addressRepo } = wire()
      await issue({ portalId: portal.id }, ctx)
      const [row] = await rowsOf(portal)
      await getPool().query(
        'UPDATE portal_tokens SET nfc_print_code_hash = NULL WHERE id = $1',
        [row?.id],
      )

      const stored = await addressRepo.fillPrintCodeHashes({
        organizationId: ORG,
        propertyId: portal.propertyId,
        portalId: portal.id,
        tokenId: row?.id ?? '',
        qr: 'a'.repeat(64),
        nfc: 'b'.repeat(64),
      })

      expect(stored).toEqual({ qr: row?.qr, nfc: 'b'.repeat(64) })
      expect((await rowsOf(portal))[0]).toMatchObject({
        qr: row?.qr,
        nfc: 'b'.repeat(64),
      })
    })

    it('does not fill under another organization, another property, or a code that is no longer live', async () => {
      const portal = await seedPortal()
      const { issue, rotate, ctx, addressRepo } = wire()
      await issue({ portalId: portal.id }, ctx)
      const [row] = await rowsOf(portal)
      await forgetHashes(portal)
      const fill = (
        overrides: Partial<Parameters<typeof addressRepo.fillPrintCodeHashes>[0]>,
      ) =>
        addressRepo.fillPrintCodeHashes({
          organizationId: ORG,
          propertyId: portal.propertyId,
          portalId: portal.id,
          tokenId: row?.id ?? '',
          qr: 'a'.repeat(64),
          nfc: 'b'.repeat(64),
          ...overrides,
        })

      await expect(fill({ organizationId: OTHER_ORG })).resolves.toBeNull()
      await expect(fill({ propertyId: propertyId(randomUUID()) })).resolves.toBeNull()
      await expect(fill({ portalId: portalId(randomUUID()) })).resolves.toBeNull()
      expect((await rowsOf(portal))[0]).toMatchObject({ qr: null, nfc: null })

      // A replaced code is `rotating` and its sealed copy is cleared: nothing to fill.
      await rotate({ portalId: portal.id }, ctx)
      await forgetHashes(portal)
      await expect(fill({})).resolves.toBeNull()
      expect((await rowsOf(portal))[0]).toMatchObject({ qr: null, nfc: null })
    })
  },
)
