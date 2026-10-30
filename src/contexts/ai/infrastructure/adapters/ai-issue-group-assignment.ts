// Deterministic issue assignment inside the Property aggregate transaction.
// The caller already holds the Property advisory lock, so this adapter uses a
// few set-based statements per analysis and never calls a provider.

import { randomUUID } from 'node:crypto'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiPropertyAggregateContributionMentions,
  aiPropertyIssueGroups,
  aiPropertyIssueMembers,
} from '#/shared/db/schema'
import {
  PROPERTY_ISSUE_NORMALIZATION_VERSION,
  TOPIC_LEVEL_ISSUE_KEY,
  normalizeIssueThing,
  type NormalizedIssueThing,
} from '#/shared/property-issue-normalization'
import type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import type { AnalysisKey } from './ai-review-analysis-mentions'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export type IssueAssignmentMention = Readonly<{
  mentionOrdinal: number
  topic: ReviewTopicV3
  normalized: NormalizedIssueThing
  candidateGroupId: string
}>

export type IssueAssignmentGroup = Readonly<{
  id: string
  topic: ReviewTopicV3
  canonicalKey: string
  canonicalThing: string | null
  mergedIntoIssueId: string | null
}>

export type IssueAssignmentMember = Readonly<{
  issueGroupId: string
  topic: ReviewTopicV3
  memberKey: string
}>

export type IssueGroupAssignmentPlan = Readonly<{
  groupsToInsert: readonly Readonly<{
    id: string
    topic: ReviewTopicV3
    canonicalKey: string
    canonicalThing: string | null
  }>[]
  membersToInsert: readonly Readonly<{
    issueGroupId: string
    topic: ReviewTopicV3
    memberKey: string
    memberThing: string | null
  }>[]
  assignments: readonly Readonly<{
    mentionOrdinal: number
    issueGroupId: string
  }>[]
}>

function issueKey(topic: ReviewTopicV3, key: string): string {
  return `${topic}\0${key}`
}

function survivingGroupId(
  groupId: string,
  groupsById: ReadonlyMap<string, IssueAssignmentGroup>,
): string {
  return groupsById.get(groupId)?.mergedIntoIssueId ?? groupId
}

function memberThing(memberKey: string): string | null {
  return memberKey === TOPIC_LEVEL_ISSUE_KEY ? null : memberKey
}

/**
 * Pure resolution policy. Stored members win over today's catalogue, then an
 * existing canonical group wins, and only then is a group planned. Redirects
 * are followed once because every manager merge flattens them.
 */
export function planIssueGroupAssignments(
  input: Readonly<{
    mentions: readonly IssueAssignmentMention[]
    groups: readonly IssueAssignmentGroup[]
    members: readonly IssueAssignmentMember[]
  }>,
): IssueGroupAssignmentPlan {
  const groupsById = new Map(input.groups.map((group) => [group.id, group]))
  const groupsByCanonical = new Map<string, IssueAssignmentGroup>()
  for (const group of [...input.groups].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const key = issueKey(group.topic, group.canonicalKey)
    const current = groupsByCanonical.get(key)
    if (current === undefined || current.mergedIntoIssueId !== null) {
      groupsByCanonical.set(key, group)
    }
  }
  const membersByKey = new Map(
    input.members.map((member) => [issueKey(member.topic, member.memberKey), member]),
  )
  const groupsToInsert: Array<IssueGroupAssignmentPlan['groupsToInsert'][number]> = []
  const membersToInsert: Array<IssueGroupAssignmentPlan['membersToInsert'][number]> = []
  const assignments: Array<IssueGroupAssignmentPlan['assignments'][number]> = []

  const addMember = (topic: ReviewTopicV3, key: string, issueGroupId: string): void => {
    const identity = issueKey(topic, key)
    if (membersByKey.has(identity)) return
    const member = { issueGroupId, topic, memberKey: key }
    membersByKey.set(identity, member)
    membersToInsert.push({ ...member, memberThing: memberThing(key) })
  }

  for (const mention of input.mentions) {
    const member = membersByKey.get(issueKey(mention.topic, mention.normalized.memberKey))
    if (member !== undefined) {
      assignments.push({
        mentionOrdinal: mention.mentionOrdinal,
        issueGroupId: survivingGroupId(member.issueGroupId, groupsById),
      })
      continue
    }

    const canonicalIdentity = issueKey(mention.topic, mention.normalized.canonicalKey)
    let group = groupsByCanonical.get(canonicalIdentity)
    if (group === undefined) {
      group = {
        id: mention.candidateGroupId,
        topic: mention.topic,
        canonicalKey: mention.normalized.canonicalKey,
        canonicalThing: mention.normalized.canonicalThing,
        mergedIntoIssueId: null,
      }
      groupsByCanonical.set(canonicalIdentity, group)
      groupsById.set(group.id, group)
      groupsToInsert.push({
        id: group.id,
        topic: group.topic,
        canonicalKey: group.canonicalKey,
        canonicalThing: group.canonicalThing,
      })
    }
    const issueGroupId = survivingGroupId(group.id, groupsById)
    addMember(mention.topic, mention.normalized.memberKey, issueGroupId)
    if (mention.normalized.memberKey !== mention.normalized.canonicalKey) {
      addMember(mention.topic, mention.normalized.canonicalKey, issueGroupId)
    }
    assignments.push({ mentionOrdinal: mention.mentionOrdinal, issueGroupId })
  }

  return Object.freeze({
    groupsToInsert: Object.freeze(groupsToInsert),
    membersToInsert: Object.freeze(membersToInsert),
    assignments: Object.freeze(assignments),
  })
}

function candidateIdByCanonical(
  mentions: readonly Readonly<{
    topic: ReviewTopicV3
    normalized: NormalizedIssueThing
  }>[],
): ReadonlyMap<string, string> {
  const ids = new Map<string, string>()
  for (const mention of mentions) {
    const key = issueKey(mention.topic, mention.normalized.canonicalKey)
    if (!ids.has(key)) ids.set(key, randomUUID())
  }
  return ids
}

async function loadSnapshot(
  tx: Transaction,
  key: AnalysisKey,
  mentions: readonly IssueAssignmentMention[],
): Promise<
  Readonly<{
    groups: readonly IssueAssignmentGroup[]
    members: readonly IssueAssignmentMember[]
  }>
> {
  const memberKeys = [...new Set(mentions.map((mention) => mention.normalized.memberKey))]
  const canonicalKeys = [
    ...new Set(mentions.map((mention) => mention.normalized.canonicalKey)),
  ]
  const members = await tx
    .select({
      issueGroupId: aiPropertyIssueMembers.issueGroupId,
      topic: aiPropertyIssueMembers.topic,
      memberKey: aiPropertyIssueMembers.memberKey,
    })
    .from(aiPropertyIssueMembers)
    .where(
      and(
        eq(aiPropertyIssueMembers.organizationId, key.organizationId),
        eq(aiPropertyIssueMembers.propertyId, key.propertyId),
        inArray(aiPropertyIssueMembers.memberKey, memberKeys),
      ),
    )
  const groupIds = members.map((member) => member.issueGroupId)
  const groups = await tx
    .select({
      id: aiPropertyIssueGroups.id,
      topic: aiPropertyIssueGroups.topic,
      canonicalKey: aiPropertyIssueGroups.canonicalKey,
      canonicalThing: aiPropertyIssueGroups.canonicalThing,
      mergedIntoIssueId: aiPropertyIssueGroups.mergedIntoIssueId,
    })
    .from(aiPropertyIssueGroups)
    .where(
      and(
        eq(aiPropertyIssueGroups.organizationId, key.organizationId),
        eq(aiPropertyIssueGroups.propertyId, key.propertyId),
        groupIds.length === 0
          ? inArray(aiPropertyIssueGroups.canonicalKey, canonicalKeys)
          : or(
              inArray(aiPropertyIssueGroups.canonicalKey, canonicalKeys),
              inArray(aiPropertyIssueGroups.id, groupIds),
            ),
      ),
    )
  return {
    groups: groups as readonly IssueAssignmentGroup[],
    members: members as readonly IssueAssignmentMember[],
  }
}

async function insertPlannedGroups(
  tx: Transaction,
  key: AnalysisKey,
  plan: IssueGroupAssignmentPlan,
  assignedAt: Date,
  expiresAt: Date,
): Promise<void> {
  if (plan.groupsToInsert.length === 0) return
  await tx
    .insert(aiPropertyIssueGroups)
    .values(
      plan.groupsToInsert.map((group) => ({
        ...group,
        organizationId: key.organizationId,
        propertyId: key.propertyId,
        displayName: null,
        mergedIntoIssueId: null,
        hiddenAt: null,
        hiddenBy: null,
        createdAt: assignedAt,
        updatedAt: assignedAt,
        lastSeenAt: assignedAt,
        expiresAt,
        normalizationVersion: PROPERTY_ISSUE_NORMALIZATION_VERSION,
      })),
    )
    .onConflictDoNothing({
      target: [
        aiPropertyIssueGroups.organizationId,
        aiPropertyIssueGroups.propertyId,
        aiPropertyIssueGroups.topic,
        aiPropertyIssueGroups.canonicalKey,
      ],
      where: sql`${aiPropertyIssueGroups.mergedIntoIssueId} IS NULL`,
    })
}

async function insertPlannedMembers(
  tx: Transaction,
  key: AnalysisKey,
  plan: IssueGroupAssignmentPlan,
  assignedAt: Date,
): Promise<void> {
  if (plan.membersToInsert.length === 0) return
  await tx
    .insert(aiPropertyIssueMembers)
    .values(
      plan.membersToInsert.map((member) => ({
        ...member,
        organizationId: key.organizationId,
        propertyId: key.propertyId,
        source: 'deterministic' as const,
        createdAt: assignedAt,
        lastSeenAt: assignedAt,
      })),
    )
    .onConflictDoNothing()
}

async function persistAssignments(
  tx: Transaction,
  key: AnalysisKey,
  mentions: readonly IssueAssignmentMention[],
  assignments: IssueGroupAssignmentPlan['assignments'],
  assignedAt: Date,
  expiresAt: Date,
): Promise<void> {
  if (assignments.length === 0) return
  const values = sql.join(
    assignments.map(
      (assignment) =>
        sql`(${assignment.mentionOrdinal}::smallint, ${assignment.issueGroupId}::uuid)`,
    ),
    sql`, `,
  )
  await tx.execute(sql`
    UPDATE ai_property_aggregate_contribution_mentions AS mention
    SET issue_group_id = assigned.issue_group_id
    FROM (VALUES ${values}) AS assigned(mention_ordinal, issue_group_id)
    WHERE mention.organization_id = ${key.organizationId}
      AND mention.property_id = ${key.propertyId}::uuid
      AND mention.review_id = ${key.reviewId}::uuid
      AND mention.source_epoch = ${key.sourceEpoch}
      AND mention.source_revision = ${key.sourceRevision}
      AND mention.analysis_sequence = ${key.analysisSequence}
      AND mention.mention_ordinal = assigned.mention_ordinal
  `)
  const usedGroupIds = [...new Set(assignments.map(({ issueGroupId }) => issueGroupId))]
  await tx
    .update(aiPropertyIssueGroups)
    .set({
      lastSeenAt: assignedAt,
      expiresAt: sql`GREATEST(${aiPropertyIssueGroups.expiresAt}, ${expiresAt})`,
    })
    .where(
      and(
        eq(aiPropertyIssueGroups.organizationId, key.organizationId),
        eq(aiPropertyIssueGroups.propertyId, key.propertyId),
        inArray(aiPropertyIssueGroups.id, usedGroupIds),
      ),
    )
  const usedMembers = [
    ...new Map(
      mentions.map((mention) => [
        `${mention.topic}\0${mention.normalized.memberKey}`,
        { topic: mention.topic, memberKey: mention.normalized.memberKey },
      ]),
    ).values(),
  ]
  await tx
    .update(aiPropertyIssueMembers)
    .set({ lastSeenAt: assignedAt })
    .where(
      and(
        eq(aiPropertyIssueMembers.organizationId, key.organizationId),
        eq(aiPropertyIssueMembers.propertyId, key.propertyId),
        or(
          ...usedMembers.map((member) =>
            and(
              eq(aiPropertyIssueMembers.topic, member.topic),
              eq(aiPropertyIssueMembers.memberKey, member.memberKey),
            ),
          ),
        ),
      ),
    )
}

/** Assign every mention of one newly copied contribution, in set-based batches. */
export async function assignContributionIssueGroups(
  tx: Transaction,
  key: AnalysisKey,
  expiresAt: Date,
  assignedAt: Date,
): Promise<number> {
  const rows = await tx
    .select({
      mentionOrdinal: aiPropertyAggregateContributionMentions.mentionOrdinal,
      topic: aiPropertyAggregateContributionMentions.topic,
      thing: aiPropertyAggregateContributionMentions.thing,
    })
    .from(aiPropertyAggregateContributionMentions)
    .where(
      and(
        eq(aiPropertyAggregateContributionMentions.organizationId, key.organizationId),
        eq(aiPropertyAggregateContributionMentions.propertyId, key.propertyId),
        eq(aiPropertyAggregateContributionMentions.reviewId, key.reviewId),
        eq(aiPropertyAggregateContributionMentions.sourceEpoch, key.sourceEpoch),
        eq(aiPropertyAggregateContributionMentions.sourceRevision, key.sourceRevision),
        eq(
          aiPropertyAggregateContributionMentions.analysisSequence,
          key.analysisSequence,
        ),
      ),
    )
  if (rows.length === 0) return 0

  const normalized = rows.map((row) => ({
    mentionOrdinal: row.mentionOrdinal,
    topic: row.topic as ReviewTopicV3,
    normalized: normalizeIssueThing(row.topic as ReviewTopicV3, row.thing),
  }))
  const ids = candidateIdByCanonical(normalized)
  const mentions: readonly IssueAssignmentMention[] = normalized.map((mention) => ({
    ...mention,
    candidateGroupId:
      ids.get(issueKey(mention.topic, mention.normalized.canonicalKey)) ?? randomUUID(),
  }))
  const initial = await loadSnapshot(tx, key, mentions)
  const initialPlan = planIssueGroupAssignments({ mentions, ...initial })
  await insertPlannedGroups(tx, key, initialPlan, assignedAt, expiresAt)

  const afterGroups = await loadSnapshot(tx, key, mentions)
  const memberPlan = planIssueGroupAssignments({ mentions, ...afterGroups })
  await insertPlannedMembers(tx, key, memberPlan, assignedAt)

  const finalSnapshot = await loadSnapshot(tx, key, mentions)
  const finalPlan = planIssueGroupAssignments({ mentions, ...finalSnapshot })
  if (finalPlan.assignments.length !== mentions.length) {
    throw new Error('Property issue assignment did not resolve every mention')
  }
  await persistAssignments(
    tx,
    key,
    mentions,
    finalPlan.assignments,
    assignedAt,
    expiresAt,
  )
  return finalPlan.assignments.length
}

/**
 * The issue a thing belongs to under a topic at a Property, found or created the way an
 * analysis's mentions are, and kept at least as long as the analysis that now points at
 * it. For a manager's changed cause: the caller holds the Property advisory lock.
 */
export async function resolveIssueGroupForThing(
  tx: Transaction,
  key: AnalysisKey,
  topic: ReviewTopicV3,
  thing: string | null,
  assignedAt: Date,
  expiresAt: Date,
): Promise<string> {
  const mention: IssueAssignmentMention = {
    mentionOrdinal: 0,
    topic,
    normalized: normalizeIssueThing(topic, thing),
    candidateGroupId: randomUUID(),
  }
  const plan = async () =>
    planIssueGroupAssignments({
      mentions: [mention],
      ...(await loadSnapshot(tx, key, [mention])),
    })
  await insertPlannedGroups(tx, key, await plan(), assignedAt, expiresAt)
  await insertPlannedMembers(tx, key, await plan(), assignedAt)
  const assignment = (await plan()).assignments.at(0)
  if (assignment === undefined) {
    throw new Error('Property issue assignment did not resolve the changed cause')
  }
  await tx
    .update(aiPropertyIssueGroups)
    .set({
      lastSeenAt: assignedAt,
      expiresAt: sql`GREATEST(${aiPropertyIssueGroups.expiresAt}, ${expiresAt})`,
    })
    .where(
      and(
        eq(aiPropertyIssueGroups.organizationId, key.organizationId),
        eq(aiPropertyIssueGroups.propertyId, key.propertyId),
        eq(aiPropertyIssueGroups.id, assignment.issueGroupId),
      ),
    )
  return assignment.issueGroupId
}
