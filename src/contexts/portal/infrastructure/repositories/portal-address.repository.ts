import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalAccessArtifacts, portalTokens } from '#/shared/db/schema/portal.schema'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type {
  RecordAddressDownloadInput,
  PortalAddressRepository,
} from '../../application/ports/portal-address.repository'
import { refusingPrintCodeCollision } from '../portal-print-code-hashes'

async function insertDownload(
  executor: Pick<Database, 'execute'>,
  input: RecordAddressDownloadInput,
): Promise<boolean> {
  const inserted = await executor.execute(sql`
        INSERT INTO portal_address_downloads
          (organization_id, property_id, portal_id, portal_token_id,
           downloaded_by, purpose, downloaded_at)
        SELECT t.organization_id, t.property_id, t.portal_id, t.id,
               ${unbrand(input.downloadedBy)}, ${input.purpose}, ${input.at}
        FROM portal_tokens t
        WHERE t.organization_id = ${unbrand(input.organizationId)}
          AND t.property_id = ${unbrand(input.propertyId)}
          AND t.portal_id = ${unbrand(input.portalId)}
          AND t.id = ${input.tokenId}
          AND t.status = 'active'
          AND t.encrypted_raw_token IS NOT NULL
        RETURNING id
      `)
  return inserted.rows.length === 1
}

/**
 * The only reader of `portal_tokens.encrypted_raw_token`. Every read is scoped
 * to one Organization and one Portal; the ciphertext is selected here and
 * nowhere else. It also reads the code's print code hashes and fills the ones a
 * code made before print codes lacks (ADR 0069), always under the same tenant
 * predicates.
 */
export const createPortalAddressRepository = (db: Database): PortalAddressRepository => ({
  findRevealable: (organizationIdValue, portalIdValue) =>
    trace('portalAddress.findRevealable', async () => {
      const scope = and(
        eq(portalTokens.organizationId, unbrand(organizationIdValue)),
        eq(portalTokens.portalId, unbrand(portalIdValue)),
      )
      // The newest code decides: an older code's sealed address was cleared
      // when it was replaced, and the table refuses any but an active code one.
      const [token] = await db
        .select({
          id: portalTokens.id,
          propertyId: portalTokens.propertyId,
          version: portalTokens.version,
          issuedAt: portalTokens.issuedAt,
          ciphertext: portalTokens.encryptedRawToken,
          keyVersion: portalTokens.addressEncryptionKeyVersion,
          qrPrintCodeHash: portalTokens.qrPrintCodeHash,
          nfcPrintCodeHash: portalTokens.nfcPrintCodeHash,
        })
        .from(portalTokens)
        .where(and(scope, eq(portalTokens.status, 'active')))
        .orderBy(desc(portalTokens.version))
        .limit(1)
      if (!token || token.ciphertext === null || token.keyVersion === null) return null

      const markers = await db
        .select({ id: portalAccessArtifacts.id, channel: portalAccessArtifacts.channel })
        .from(portalAccessArtifacts)
        .where(
          and(
            eq(portalAccessArtifacts.organizationId, unbrand(organizationIdValue)),
            eq(portalAccessArtifacts.portalId, unbrand(portalIdValue)),
            eq(portalAccessArtifacts.portalTokenId, token.id),
            eq(portalAccessArtifacts.status, 'published'),
            isNull(portalAccessArtifacts.retiredAt),
          ),
        )
      const qr = markers.find((marker) => marker.channel === 'qr')
      const nfc = markers.find((marker) => marker.channel === 'nfc')
      if (!qr || !nfc) return null
      return {
        tokenId: token.id,
        propertyId: token.propertyId,
        version: token.version,
        issuedAt: token.issuedAt,
        sealed: { ciphertext: token.ciphertext, keyVersion: token.keyVersion },
        accessArtifactIds: { qr: qr.id, nfc: nfc.id },
        printCodeHashes: { qr: token.qrPrintCodeHash, nfc: token.nfcPrintCodeHash },
      }
    }),

  recordDownload: (input) =>
    trace('portalAddress.recordDownload', async () => {
      if (input.oncePerUserToken) {
        return db.transaction(async (tx) => {
          const live = await tx.execute(
            sql`SELECT id FROM portal_tokens WHERE organization_id = ${input.organizationId} AND portal_id = ${input.portalId} AND id = ${input.tokenId}::uuid AND status = 'active' AND encrypted_raw_token IS NOT NULL FOR UPDATE`,
          )
          if (!live.rows.length) return false
          const previous = await tx.execute(
            sql`SELECT id FROM portal_address_downloads WHERE organization_id = ${input.organizationId} AND portal_token_id = ${input.tokenId}::uuid AND downloaded_by = ${input.downloadedBy} AND purpose = 'show' LIMIT 1`,
          )
          if (previous.rows.length) return true
          return insertDownload(tx, input)
        })
      }
      // One statement, so the row exists only for a code that is still active
      // and still holds a sealed address at the instant it is written.
      return insertDownload(db, input)
    }),

  fillPrintCodeHashes: (input) =>
    trace('portalAddress.fillPrintCodeHashes', async () => {
      // One statement. COALESCE keeps a hash that is already there, so a racing
      // reveal (or the code's own issue) is never overwritten, and RETURNING says
      // what the row holds now. The tenant predicates are the same as the
      // download row's, and the row must still be an active, sealed code: a
      // stopped or replaced code is not filled.
      const updated = await refusingPrintCodeCollision(() =>
        db.execute<{ qr: string | null; nfc: string | null }>(sql`
          UPDATE portal_tokens
          SET qr_print_code_hash = COALESCE(qr_print_code_hash, ${input.qr}),
              nfc_print_code_hash = COALESCE(nfc_print_code_hash, ${input.nfc})
          WHERE organization_id = ${unbrand(input.organizationId)}
            AND property_id = ${unbrand(input.propertyId)}
            AND portal_id = ${unbrand(input.portalId)}
            AND id = ${input.tokenId}
            AND status = 'active'
            AND encrypted_raw_token IS NOT NULL
          RETURNING qr_print_code_hash AS qr, nfc_print_code_hash AS nfc
        `),
      )
      const [row] = updated.rows
      return row === undefined ? null : { qr: row.qr, nfc: row.nfc }
    }),
})
