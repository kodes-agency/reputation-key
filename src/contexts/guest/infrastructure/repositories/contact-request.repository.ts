import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { member } from '#/shared/db/schema/auth'
import {
  guestContactRequestPurgeCheckpoints,
  guestContactRequestRevealAudits,
  guestContactRequests,
  guestResponses,
} from '#/shared/db/schema/guest.schema'
import { propertyAccessGrant } from '#/shared/db/schema/policy.schema'
import { portalResponsibleManagers, portals } from '#/shared/db/schema/portal.schema'
import type { ContactRequestEncryptionPort } from '../../application/ports/contact-request-encryption.port'
import type { ContactRequestRepository } from '../../application/ports/contact-request.repository'

const PURGE_AUTHORITY = 'guest-contact-30d-v1'

type AuthorityBasis = 'account_admin' | 'portal_creator' | 'responsible_manager'

export function createContactRequestRepository(
  db: Database,
  encryption: ContactRequestEncryptionPort,
): ContactRequestRepository {
  return {
    create: async (input) => {
      const sealed = encryption.seal(
        {
          email: input.email,
          ...(input.name === undefined ? {} : { name: input.name }),
        },
        {
          ...input.scope,
          contactRequestId: input.id,
        },
      )
      return db.transaction(async (tx) => {
        const [response] = await tx
          .select({ id: guestResponses.id })
          .from(guestResponses)
          .where(
            and(
              eq(guestResponses.id, input.responseId),
              eq(guestResponses.organizationId, input.scope.organizationId),
              eq(guestResponses.propertyId, input.scope.propertyId),
              eq(guestResponses.portalId, input.scope.portalId),
              inArray(guestResponses.status, ['submitted', 'corrected']),
              isNull(guestResponses.deletedAt),
            ),
          )
          .for('update')
          .limit(1)
        if (!response) return { outcome: 'source_unavailable' as const }

        const inserted = await tx
          .insert(guestContactRequests)
          .values({
            id: input.id,
            organizationId: input.scope.organizationId,
            propertyId: input.scope.propertyId,
            portalId: input.scope.portalId,
            responseId: input.responseId,
            purpose: input.purpose,
            consentGranted: input.consent,
            encryptedContact: sealed.ciphertext,
            encryptionKeyId: sealed.keyId,
            status: 'active',
            submittedAt: input.submittedAt,
            expiresAt: input.expiresAt,
            createdAt: input.submittedAt,
            updatedAt: input.submittedAt,
          })
          .onConflictDoNothing()
          .returning({ id: guestContactRequests.id })
        return {
          outcome: inserted[0] ? ('created' as const) : ('duplicate' as const),
        }
      })
    },

    findMasked: async (scope, contactRequestId, asOf) => {
      // Intentionally does not select encryptedContact or encryptionKeyId.
      const [row] = await db
        .select({
          id: guestContactRequests.id,
          organizationId: guestContactRequests.organizationId,
          propertyId: guestContactRequests.propertyId,
          portalId: guestContactRequests.portalId,
          responseId: guestContactRequests.responseId,
          purpose: guestContactRequests.purpose,
          submittedAt: guestContactRequests.submittedAt,
          expiresAt: guestContactRequests.expiresAt,
        })
        .from(guestContactRequests)
        .where(
          and(
            eq(guestContactRequests.id, contactRequestId),
            eq(guestContactRequests.organizationId, scope.organizationId),
            eq(guestContactRequests.propertyId, scope.propertyId),
            eq(guestContactRequests.portalId, scope.portalId),
            eq(guestContactRequests.status, 'active'),
            eq(guestContactRequests.consentGranted, true),
            gt(guestContactRequests.expiresAt, asOf),
          ),
        )
        .limit(1)
      return row
        ? {
            id: row.id,
            scope: {
              organizationId: row.organizationId,
              propertyId: row.propertyId,
              portalId: row.portalId,
            },
            responseId: row.responseId,
            purpose: row.purpose as 'manager_follow_up',
            maskedContact: '••••••••',
            submittedAt: row.submittedAt,
            expiresAt: row.expiresAt,
          }
        : null
    },

    reveal: async (input) =>
      db.transaction(async (tx) => {
        const [request] = await tx
          .select({
            encryptedContact: guestContactRequests.encryptedContact,
            encryptionKeyId: guestContactRequests.encryptionKeyId,
          })
          .from(guestContactRequests)
          .where(
            and(
              eq(guestContactRequests.id, input.contactRequestId),
              eq(guestContactRequests.organizationId, input.scope.organizationId),
              eq(guestContactRequests.propertyId, input.scope.propertyId),
              eq(guestContactRequests.portalId, input.scope.portalId),
              eq(guestContactRequests.status, 'active'),
              eq(guestContactRequests.consentGranted, true),
              gt(guestContactRequests.expiresAt, input.at),
            ),
          )
          .for('update')
          .limit(1)
        if (!request) {
          const [exists] = await tx
            .select({ id: guestContactRequests.id })
            .from(guestContactRequests)
            .where(
              and(
                eq(guestContactRequests.id, input.contactRequestId),
                eq(guestContactRequests.organizationId, input.scope.organizationId),
                eq(guestContactRequests.propertyId, input.scope.propertyId),
                eq(guestContactRequests.portalId, input.scope.portalId),
              ),
            )
            .limit(1)
          return { outcome: exists ? ('unavailable' as const) : ('not_found' as const) }
        }

        const [membership] = await tx
          .select({ role: member.role })
          .from(member)
          .where(
            and(
              eq(member.organizationId, input.scope.organizationId),
              eq(member.userId, input.actorId),
              inArray(member.role, ['owner', 'admin']),
            ),
          )
          .for('share')
          .limit(1)
        if (!membership) return { outcome: 'not_authorized' as const }

        let authority: AuthorityBasis | null =
          membership.role === 'owner' ? 'account_admin' : null
        if (!authority) {
          const [accessGrant] = await tx
            .select({ id: propertyAccessGrant.id })
            .from(propertyAccessGrant)
            .where(
              and(
                eq(propertyAccessGrant.organizationId, input.scope.organizationId),
                eq(propertyAccessGrant.propertyId, input.scope.propertyId),
                eq(propertyAccessGrant.userId, input.actorId),
                isNull(propertyAccessGrant.revokedAt),
                or(
                  isNull(propertyAccessGrant.expiresAt),
                  gt(propertyAccessGrant.expiresAt, input.at),
                ),
              ),
            )
            .for('share')
            .limit(1)
          if (!accessGrant) return { outcome: 'not_authorized' as const }
        }
        if (!authority) {
          const [portal] = await tx
            .select({ createdBy: portals.createdBy })
            .from(portals)
            .where(
              and(
                eq(portals.organizationId, input.scope.organizationId),
                eq(portals.propertyId, input.scope.propertyId),
                eq(portals.id, input.scope.portalId),
                isNull(portals.deletedAt),
              ),
            )
            .for('share')
            .limit(1)
          if (portal?.createdBy === input.actorId) authority = 'portal_creator'
        }
        if (!authority) {
          const [responsibility] = await tx
            .select({ id: portalResponsibleManagers.id })
            .from(portalResponsibleManagers)
            .where(
              and(
                eq(portalResponsibleManagers.organizationId, input.scope.organizationId),
                eq(portalResponsibleManagers.propertyId, input.scope.propertyId),
                eq(portalResponsibleManagers.portalId, input.scope.portalId),
                eq(portalResponsibleManagers.userId, input.actorId),
                lte(portalResponsibleManagers.effectiveFrom, input.at),
                or(
                  isNull(portalResponsibleManagers.effectiveTo),
                  gt(portalResponsibleManagers.effectiveTo, input.at),
                ),
              ),
            )
            .for('share')
            .limit(1)
          if (responsibility) authority = 'responsible_manager'
        }
        if (!authority) return { outcome: 'not_authorized' as const }
        if (!request.encryptedContact || !request.encryptionKeyId) {
          return { outcome: 'unavailable' as const }
        }

        const contact = encryption.open(
          {
            keyId: request.encryptionKeyId,
            ciphertext: request.encryptedContact,
          },
          { ...input.scope, contactRequestId: input.contactRequestId },
        )
        await tx.insert(guestContactRequestRevealAudits).values({
          contactRequestId: input.contactRequestId,
          organizationId: input.scope.organizationId,
          propertyId: input.scope.propertyId,
          portalId: input.scope.portalId,
          actorId: input.actorId,
          accessPurpose: input.accessPurpose,
          authorityBasis: authority,
          revealedAt: input.at,
          createdAt: input.at,
        })
        return { outcome: 'revealed' as const, ...contact }
      }),

    withdraw: async (input) =>
      db.transaction(async (tx) => {
        const [request] = await tx
          .select({ status: guestContactRequests.status })
          .from(guestContactRequests)
          .where(
            and(
              eq(guestContactRequests.id, input.contactRequestId),
              eq(guestContactRequests.organizationId, input.scope.organizationId),
              eq(guestContactRequests.propertyId, input.scope.propertyId),
              eq(guestContactRequests.portalId, input.scope.portalId),
            ),
          )
          .for('update')
          .limit(1)
        if (!request) return { outcome: 'not_found' as const }
        if (request.status !== 'active') return { outcome: 'unavailable' as const }
        const updated = await tx
          .update(guestContactRequests)
          .set({
            status: 'withdrawn',
            consentGranted: false,
            encryptedContact: null,
            withdrawnAt: input.at,
            purgedAt: null,
            updatedAt: input.at,
          })
          .where(
            and(
              eq(guestContactRequests.id, input.contactRequestId),
              eq(guestContactRequests.organizationId, input.scope.organizationId),
              eq(guestContactRequests.propertyId, input.scope.propertyId),
              eq(guestContactRequests.portalId, input.scope.portalId),
              eq(guestContactRequests.status, 'active'),
            ),
          )
          .returning({ id: guestContactRequests.id })
        return {
          outcome: updated[0] ? ('withdrawn' as const) : ('unavailable' as const),
        }
      }),

    purgeExpired: async (input) =>
      db.transaction(async (tx) => {
        await tx
          .insert(guestContactRequestPurgeCheckpoints)
          .values({ authority: PURGE_AUTHORITY })
          .onConflictDoNothing()
        const [checkpoint] = await tx
          .select()
          .from(guestContactRequestPurgeCheckpoints)
          .where(eq(guestContactRequestPurgeCheckpoints.authority, PURGE_AUTHORITY))
          .for('update')
          .limit(1)
        if (!checkpoint) throw new Error('Contact Request purge authority unavailable')

        const expired = await tx
          .select({
            id: guestContactRequests.id,
            expiresAt: guestContactRequests.expiresAt,
          })
          .from(guestContactRequests)
          .where(
            and(
              eq(guestContactRequests.status, 'active'),
              lte(guestContactRequests.expiresAt, input.through),
            ),
          )
          .orderBy(asc(guestContactRequests.expiresAt), asc(guestContactRequests.id))
          .limit(input.batchSize)
          .for('update')

        if (expired.length > 0) {
          await tx
            .update(guestContactRequests)
            .set({
              status: 'expired',
              consentGranted: false,
              encryptedContact: null,
              withdrawnAt: null,
              purgedAt: input.through,
              updatedAt: input.through,
            })
            .where(
              and(
                inArray(
                  guestContactRequests.id,
                  expired.map((row) => row.id),
                ),
                eq(guestContactRequests.status, 'active'),
              ),
            )
          const last = expired.at(-1)!
          await tx
            .update(guestContactRequestPurgeCheckpoints)
            .set({
              cursorExpiresAt: last.expiresAt,
              cursorId: last.id,
              processedCount: sql`${guestContactRequestPurgeCheckpoints.processedCount} + ${expired.length}`,
              updatedAt: input.through,
            })
            .where(eq(guestContactRequestPurgeCheckpoints.authority, PURGE_AUTHORITY))
          return {
            processed: expired.length,
            checkpoint: { expiresAt: last.expiresAt, id: last.id },
            completedThrough: checkpoint.completedThrough,
          }
        }

        const completedThrough =
          checkpoint.completedThrough && checkpoint.completedThrough > input.through
            ? checkpoint.completedThrough
            : input.through
        await tx
          .update(guestContactRequestPurgeCheckpoints)
          .set({ completedThrough, updatedAt: input.through })
          .where(eq(guestContactRequestPurgeCheckpoints.authority, PURGE_AUTHORITY))
        return {
          processed: 0,
          checkpoint:
            checkpoint.cursorExpiresAt && checkpoint.cursorId
              ? { expiresAt: checkpoint.cursorExpiresAt, id: checkpoint.cursorId }
              : null,
          completedThrough,
        }
      }),
  }
}
