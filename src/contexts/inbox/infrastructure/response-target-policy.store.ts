import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  inboxPrivateFeedbackTargetPropertyOverrides,
  inboxResponseTargetOrganizationPolicies,
} from '#/shared/db/schema/inbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAfterCommit, insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import type {
  ResponseTargetPolicyStore,
  ResponseTargetPolicySettings,
  ResponseTargetPolicyWriteResult,
} from '../application/ports/response-target-policy.store'
import { DEFAULT_RESPONSE_TARGET_MINUTES } from '../domain/response-target'
import { inboxResponseTargetPolicyChanged } from '../domain/events'
import { inboxError } from '../domain/errors'

const assertDuration = (durationMinutes: number | null, allowDisabled: boolean): void => {
  if (
    (durationMinutes === null && !allowDisabled) ||
    (durationMinutes !== null &&
      (!Number.isSafeInteger(durationMinutes) ||
        durationMinutes < 1 ||
        durationMinutes > 43_200))
  ) {
    throw inboxError('invalid_input', 'Response Target duration must be 1–43,200 minutes')
  }
}

const assertExpectedVersion = (version: number | null): void => {
  if (version !== null && (!Number.isSafeInteger(version) || version < 1)) {
    throw inboxError(
      'invalid_input',
      'Expected Response Target policy version is invalid',
    )
  }
}

const versionConflict = (currentPolicyVersion: number | null) =>
  inboxError('revision_conflict', 'Response Target policy changed; reload', {
    currentPolicyVersion,
  })

export const createResponseTargetPolicyStore = (
  db: Database,
  events: EventBus,
): ResponseTargetPolicyStore => ({
  getPolicySettings: async (orgId, requestedPropertyId) =>
    trace('inbox.responseTargetPolicy.getSettings', async () => {
      const organizationRows = await db
        .select({
          targetKind: inboxResponseTargetOrganizationPolicies.targetKind,
          durationMinutes: inboxResponseTargetOrganizationPolicies.durationMinutes,
          policyVersion: inboxResponseTargetOrganizationPolicies.policyVersion,
        })
        .from(inboxResponseTargetOrganizationPolicies)
        .where(eq(inboxResponseTargetOrganizationPolicies.organizationId, orgId))
      const byKind = new Map(organizationRows.map((row) => [row.targetKind, row]))
      const organizationView = (
        targetKind: 'google_review_response' | 'private_feedback_handling',
      ) => {
        const stored = byKind.get(targetKind)
        return stored
          ? {
              targetKind,
              durationMinutes: stored.durationMinutes,
              policySource: 'organization_policy' as const,
              policyVersion: stored.policyVersion,
            }
          : {
              targetKind,
              durationMinutes: DEFAULT_RESPONSE_TARGET_MINUTES,
              policySource: 'builtin_default' as const,
              policyVersion: null,
            }
      }
      const privateFeedbackHandling = organizationView('private_feedback_handling')
      let privateFeedbackPropertyOverride: ResponseTargetPolicySettings['privateFeedbackPropertyOverride'] =
        null
      if (requestedPropertyId) {
        const [row] = await db
          .select({
            propertyId: properties.id,
            enabled: inboxPrivateFeedbackTargetPropertyOverrides.enabled,
            durationMinutes: inboxPrivateFeedbackTargetPropertyOverrides.durationMinutes,
            policyVersion: inboxPrivateFeedbackTargetPropertyOverrides.policyVersion,
          })
          .from(properties)
          .leftJoin(
            inboxPrivateFeedbackTargetPropertyOverrides,
            and(
              eq(inboxPrivateFeedbackTargetPropertyOverrides.organizationId, orgId),
              eq(inboxPrivateFeedbackTargetPropertyOverrides.propertyId, properties.id),
            ),
          )
          .where(
            and(
              eq(properties.organizationId, orgId),
              eq(properties.id, requestedPropertyId),
            ),
          )
          .limit(1)
        if (!row) throw inboxError('not_found', 'Property not found for Response Target')
        const overrideDurationMinutes =
          row.enabled === true && row.durationMinutes !== null
            ? row.durationMinutes
            : null
        privateFeedbackPropertyOverride = {
          propertyId: requestedPropertyId,
          durationMinutes: overrideDurationMinutes,
          policyVersion: row.policyVersion,
          effectiveDurationMinutes:
            overrideDurationMinutes ?? privateFeedbackHandling.durationMinutes,
          effectiveSource:
            overrideDurationMinutes !== null
              ? 'property_override'
              : privateFeedbackHandling.policySource,
        }
      }
      return {
        organization: {
          googleReviewResponse: organizationView('google_review_response'),
          privateFeedbackHandling,
        },
        privateFeedbackPropertyOverride,
      }
    }),

  setOrganizationPolicy: async (command) =>
    trace('inbox.responseTargetPolicy.setOrganization', async () => {
      assertDuration(command.durationMinutes, false)
      assertExpectedVersion(command.expectedPolicyVersion)
      const committed = await db.transaction(async (tx) => {
        const policyLockKey = JSON.stringify([command.organizationId, command.targetKind])
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${policyLockKey}, 0))`,
        )
        const [current] = await tx
          .select()
          .from(inboxResponseTargetOrganizationPolicies)
          .where(
            and(
              eq(
                inboxResponseTargetOrganizationPolicies.organizationId,
                command.organizationId,
              ),
              eq(inboxResponseTargetOrganizationPolicies.targetKind, command.targetKind),
            ),
          )
          .for('update')
          .limit(1)
        if (!current && command.expectedPolicyVersion !== null) {
          throw versionConflict(null)
        }
        if (current && current.policyVersion !== command.expectedPolicyVersion) {
          throw versionConflict(current.policyVersion)
        }
        const nextVersion = current ? current.policyVersion + 1 : 1
        if (!Number.isSafeInteger(nextVersion)) {
          throw inboxError(
            'revision_conflict',
            'Response Target policy version exhausted',
          )
        }
        if (current) {
          const [saved] = await tx
            .update(inboxResponseTargetOrganizationPolicies)
            .set({
              durationMinutes: command.durationMinutes,
              policyVersion: nextVersion,
              updatedBy: command.actorUserId,
              updatedAt: command.at,
            })
            .where(
              and(
                eq(
                  inboxResponseTargetOrganizationPolicies.organizationId,
                  command.organizationId,
                ),
                eq(
                  inboxResponseTargetOrganizationPolicies.targetKind,
                  command.targetKind,
                ),
                eq(
                  inboxResponseTargetOrganizationPolicies.policyVersion,
                  current.policyVersion,
                ),
              ),
            )
            .returning({
              policyVersion: inboxResponseTargetOrganizationPolicies.policyVersion,
            })
          if (!saved) throw versionConflict(current.policyVersion)
        } else {
          await tx.insert(inboxResponseTargetOrganizationPolicies).values({
            organizationId: command.organizationId,
            targetKind: command.targetKind,
            durationMinutes: command.durationMinutes,
            policyVersion: nextVersion,
            updatedBy: command.actorUserId,
            createdAt: command.at,
            updatedAt: command.at,
          })
        }
        const result: ResponseTargetPolicyWriteResult = {
          scope: 'organization',
          targetKind: command.targetKind,
          propertyId: null,
          durationMinutes: command.durationMinutes,
          policyVersion: nextVersion,
        }
        const fact = inboxResponseTargetPolicyChanged({
          organizationId: command.organizationId,
          propertyId: null,
          targetKind: command.targetKind,
          policyScope: 'organization',
          durationMinutes: command.durationMinutes,
          policyVersion: nextVersion,
          userId: command.actorUserId,
          occurredAt: command.at,
        })
        await insertOutboxRow(tx, fact, { recordedAt: command.at })
        return { result, fact }
      })
      await emitAfterCommit(events, committed.fact)
      return committed.result
    }),

  setPrivateFeedbackPropertyOverride: async (command) =>
    trace('inbox.responseTargetPolicy.setPropertyOverride', async () => {
      assertDuration(command.durationMinutes, true)
      assertExpectedVersion(command.expectedPolicyVersion)
      const committed = await db.transaction(async (tx) => {
        const policyLockKey = JSON.stringify([
          command.organizationId,
          command.propertyId,
          'private_feedback_handling',
        ])
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${policyLockKey}, 0))`,
        )
        const [property] = await tx
          .select({ id: properties.id })
          .from(properties)
          .where(
            and(
              eq(properties.organizationId, command.organizationId),
              eq(properties.id, command.propertyId),
            ),
          )
          .for('key share')
          .limit(1)
        if (!property) {
          throw inboxError('not_found', 'Property not found for Response Target')
        }
        const [current] = await tx
          .select()
          .from(inboxPrivateFeedbackTargetPropertyOverrides)
          .where(
            and(
              eq(
                inboxPrivateFeedbackTargetPropertyOverrides.organizationId,
                command.organizationId,
              ),
              eq(
                inboxPrivateFeedbackTargetPropertyOverrides.propertyId,
                command.propertyId,
              ),
            ),
          )
          .for('update')
          .limit(1)
        if (!current && command.expectedPolicyVersion !== null) {
          throw versionConflict(null)
        }
        if (current && current.policyVersion !== command.expectedPolicyVersion) {
          throw versionConflict(current.policyVersion)
        }
        const nextVersion = current ? current.policyVersion + 1 : 1
        if (!Number.isSafeInteger(nextVersion)) {
          throw inboxError(
            'revision_conflict',
            'Response Target policy version exhausted',
          )
        }
        const values = {
          enabled: command.durationMinutes !== null,
          durationMinutes: command.durationMinutes,
          policyVersion: nextVersion,
          updatedBy: command.actorUserId,
          updatedAt: command.at,
        }
        if (current) {
          const [saved] = await tx
            .update(inboxPrivateFeedbackTargetPropertyOverrides)
            .set(values)
            .where(
              and(
                eq(
                  inboxPrivateFeedbackTargetPropertyOverrides.organizationId,
                  command.organizationId,
                ),
                eq(
                  inboxPrivateFeedbackTargetPropertyOverrides.propertyId,
                  command.propertyId,
                ),
                eq(
                  inboxPrivateFeedbackTargetPropertyOverrides.policyVersion,
                  current.policyVersion,
                ),
              ),
            )
            .returning({
              policyVersion: inboxPrivateFeedbackTargetPropertyOverrides.policyVersion,
            })
          if (!saved) throw versionConflict(current.policyVersion)
        } else {
          await tx.insert(inboxPrivateFeedbackTargetPropertyOverrides).values({
            organizationId: command.organizationId,
            propertyId: command.propertyId,
            ...values,
            createdAt: command.at,
          })
        }
        const result: ResponseTargetPolicyWriteResult = {
          scope: 'property',
          targetKind: 'private_feedback_handling',
          propertyId: command.propertyId,
          durationMinutes: command.durationMinutes,
          policyVersion: nextVersion,
        }
        const fact = inboxResponseTargetPolicyChanged({
          organizationId: command.organizationId,
          propertyId: command.propertyId,
          targetKind: 'private_feedback_handling',
          policyScope: 'property',
          durationMinutes: command.durationMinutes,
          policyVersion: nextVersion,
          userId: command.actorUserId,
          occurredAt: command.at,
        })
        await insertOutboxRow(tx, fact, { recordedAt: command.at })
        return { result, fact }
      })
      await emitAfterCommit(events, committed.fact)
      return committed.result
    }),
})
