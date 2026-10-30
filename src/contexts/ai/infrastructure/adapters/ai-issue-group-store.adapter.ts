// Drizzle persistence for the dark Property issue manager commands. Every
// mutation takes the same Property advisory lock as aggregate assignment, then
// locks the group rows it changes. All statements carry both tenant values.

import { and, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import {
  aiPropertyAggregateContributionMentions,
  aiPropertyIssueGroups,
  aiPropertyIssueMembers,
} from '#/shared/db/schema'
import { isReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import type {
  AiIssueGroupStorePort,
  PropertyIssueGroup,
  PropertyIssueResolveResult,
  PropertyIssueScope,
} from '../../application/ports/ai-issue-group-store.port'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type GroupRow = typeof aiPropertyIssueGroups.$inferSelect

function mapGroup(row: GroupRow): PropertyIssueGroup {
  if (!isReviewTopicV3(row.topic)) {
    throw new Error('Property issue group has an unknown topic')
  }
  return Object.freeze({ ...row, topic: row.topic })
}

async function lockProperty(tx: Transaction, scope: PropertyIssueScope): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${scope.organizationId} || ':' || ${scope.propertyId}::text, 0)
    )
  `)
}

async function lockGroup(
  tx: Transaction,
  scope: PropertyIssueScope,
  issueId: string,
): Promise<GroupRow | null> {
  const [row] = await tx
    .select()
    .from(aiPropertyIssueGroups)
    .where(
      and(
        eq(aiPropertyIssueGroups.organizationId, scope.organizationId),
        eq(aiPropertyIssueGroups.propertyId, scope.propertyId),
        eq(aiPropertyIssueGroups.id, issueId),
      ),
    )
    .limit(1)
    .for('update')
  return row ?? null
}

async function resolveLocked(
  tx: Transaction,
  scope: PropertyIssueScope,
  issueId: string,
): Promise<Readonly<{ row: GroupRow; redirectedFromIssueId: string | null }> | null> {
  const row = await lockGroup(tx, scope, issueId)
  if (row === null) return null
  if (row.mergedIntoIssueId === null) {
    return { row, redirectedFromIssueId: null }
  }
  const target = await lockGroup(tx, scope, row.mergedIntoIssueId)
  if (target === null || target.mergedIntoIssueId !== null) {
    throw new Error('Property issue redirect is not one hop')
  }
  return { row: target, redirectedFromIssueId: issueId }
}

/**
 * A read, so it takes neither the Property lock nor a row lock: showing an issue
 * never waits for an analysis to be stored. One statement joins a redirect to its
 * target, so a merge cannot land between the two reads.
 */
async function readResolved(
  db: Database,
  scope: PropertyIssueScope,
  issueId: string,
): Promise<PropertyIssueResolveResult> {
  const target = alias(aiPropertyIssueGroups, 'target_group')
  const [row] = await db
    .select({ source: aiPropertyIssueGroups, target })
    .from(aiPropertyIssueGroups)
    .leftJoin(
      target,
      and(
        eq(target.organizationId, aiPropertyIssueGroups.organizationId),
        eq(target.propertyId, aiPropertyIssueGroups.propertyId),
        eq(target.id, aiPropertyIssueGroups.mergedIntoIssueId),
      ),
    )
    .where(
      and(
        eq(aiPropertyIssueGroups.organizationId, scope.organizationId),
        eq(aiPropertyIssueGroups.propertyId, scope.propertyId),
        eq(aiPropertyIssueGroups.id, issueId),
      ),
    )
    .limit(1)
  if (row === undefined) return { status: 'not_found' }
  if (row.source.mergedIntoIssueId === null) {
    return { status: 'found', issue: mapGroup(row.source), redirectedFromIssueId: null }
  }
  if (row.target === null || row.target.mergedIntoIssueId !== null) {
    throw new Error('Property issue redirect is not one hop')
  }
  return {
    status: 'found',
    issue: mapGroup(row.target),
    redirectedFromIssueId: issueId,
  }
}

export function createAiIssueGroupStoreAdapter(db: Database): AiIssueGroupStorePort {
  return Object.freeze({
    async rename(scope, issueId, displayName, updatedAt) {
      return db.transaction(async (tx) => {
        await lockProperty(tx, scope)
        const resolved = await resolveLocked(tx, scope, issueId)
        if (resolved === null) return { status: 'not_found' }
        const [updated] = await tx
          .update(aiPropertyIssueGroups)
          .set({ displayName, updatedAt })
          .where(
            and(
              eq(aiPropertyIssueGroups.organizationId, scope.organizationId),
              eq(aiPropertyIssueGroups.propertyId, scope.propertyId),
              eq(aiPropertyIssueGroups.id, resolved.row.id),
            ),
          )
          .returning()
        if (updated === undefined) throw new Error('Property issue rename lost its row')
        return { status: 'applied', issue: mapGroup(updated) }
      })
    },

    async setHidden(scope, issueId, hidden, updatedAt) {
      return db.transaction(async (tx) => {
        await lockProperty(tx, scope)
        const resolved = await resolveLocked(tx, scope, issueId)
        if (resolved === null) return { status: 'not_found' }
        const alreadyInState =
          hidden === null
            ? resolved.row.hiddenAt === null
            : resolved.row.hiddenAt !== null
        if (alreadyInState) {
          return { status: 'applied', changed: false, issue: mapGroup(resolved.row) }
        }
        const [updated] = await tx
          .update(aiPropertyIssueGroups)
          .set({
            hiddenAt: hidden?.at ?? null,
            hiddenBy: hidden?.by ?? null,
            updatedAt,
          })
          .where(
            and(
              eq(aiPropertyIssueGroups.organizationId, scope.organizationId),
              eq(aiPropertyIssueGroups.propertyId, scope.propertyId),
              eq(aiPropertyIssueGroups.id, resolved.row.id),
            ),
          )
          .returning()
        if (updated === undefined) {
          throw new Error('Property issue visibility change lost its row')
        }
        return { status: 'applied', changed: true, issue: mapGroup(updated) }
      })
    },

    async merge(scope, sourceIssueId, targetIssueId, updatedAt) {
      return db.transaction(async (tx) => {
        await lockProperty(tx, scope)
        const source = await resolveLocked(tx, scope, sourceIssueId)
        const target = await resolveLocked(tx, scope, targetIssueId)
        if (source === null || target === null) return { status: 'not_found' }
        if (source.row.id === target.row.id) return { status: 'same_issue' }
        // A read-model issue has exactly one topic, and contract 5.2 permits
        // only same-topic merge proposals. The composite FK repeats this rule.
        if (source.row.topic !== target.row.topic) return { status: 'cross_topic' }

        await tx
          .select({ id: aiPropertyIssueGroups.id })
          .from(aiPropertyIssueGroups)
          .where(
            and(
              eq(aiPropertyIssueGroups.organizationId, scope.organizationId),
              eq(aiPropertyIssueGroups.propertyId, scope.propertyId),
              eq(aiPropertyIssueGroups.mergedIntoIssueId, source.row.id),
            ),
          )
          .for('update')
        await tx
          .update(aiPropertyIssueGroups)
          .set({ mergedIntoIssueId: target.row.id, updatedAt })
          .where(
            and(
              eq(aiPropertyIssueGroups.organizationId, scope.organizationId),
              eq(aiPropertyIssueGroups.propertyId, scope.propertyId),
              eq(aiPropertyIssueGroups.mergedIntoIssueId, source.row.id),
            ),
          )
        await tx
          .update(aiPropertyIssueMembers)
          .set({
            issueGroupId: target.row.id,
            source: 'manager',
          })
          .where(
            and(
              eq(aiPropertyIssueMembers.organizationId, scope.organizationId),
              eq(aiPropertyIssueMembers.propertyId, scope.propertyId),
              eq(aiPropertyIssueMembers.issueGroupId, source.row.id),
            ),
          )
        await tx
          .update(aiPropertyAggregateContributionMentions)
          .set({ issueGroupId: target.row.id })
          .where(
            and(
              eq(
                aiPropertyAggregateContributionMentions.organizationId,
                scope.organizationId,
              ),
              eq(aiPropertyAggregateContributionMentions.propertyId, scope.propertyId),
              eq(aiPropertyAggregateContributionMentions.issueGroupId, source.row.id),
            ),
          )
        await tx
          .update(aiPropertyIssueGroups)
          .set({ mergedIntoIssueId: target.row.id, updatedAt })
          .where(
            and(
              eq(aiPropertyIssueGroups.organizationId, scope.organizationId),
              eq(aiPropertyIssueGroups.propertyId, scope.propertyId),
              eq(aiPropertyIssueGroups.id, source.row.id),
            ),
          )
        const [updatedTarget] = await tx
          .update(aiPropertyIssueGroups)
          .set({
            expiresAt: sql`GREATEST(${aiPropertyIssueGroups.expiresAt}, ${source.row.expiresAt})`,
            updatedAt,
          })
          .where(
            and(
              eq(aiPropertyIssueGroups.organizationId, scope.organizationId),
              eq(aiPropertyIssueGroups.propertyId, scope.propertyId),
              eq(aiPropertyIssueGroups.id, target.row.id),
            ),
          )
          .returning()
        if (updatedTarget === undefined) {
          throw new Error('Property issue merge lost its target')
        }
        return {
          status: 'applied',
          issue: mapGroup(updatedTarget),
          sourceIssueId: source.row.id,
        }
      })
    },

    async resolve(scope, issueId) {
      return readResolved(db, scope, issueId)
    },
  })
}
