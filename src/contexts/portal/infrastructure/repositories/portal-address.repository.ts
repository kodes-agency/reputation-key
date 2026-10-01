import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalAccessArtifacts, portalTokens } from '#/shared/db/schema/portal.schema'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { PortalAddressRepository } from '../../application/ports/portal-address.repository'

/**
 * The only reader of `portal_tokens.encrypted_raw_token`. Every read is scoped
 * to one Organization and one Portal; the ciphertext is selected here and
 * nowhere else.
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
      }
    }),

  recordDownload: (input) =>
    trace('portalAddress.recordDownload', async () => {
      // One statement, so the row exists only for a code that is still active
      // and still holds a sealed address at the instant it is written.
      const inserted = await db.execute(sql`
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
    }),
})
