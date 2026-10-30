// Stable, Property-local issue identities for Review Analysis v3. A group
// represents only the bounded `thing` phrase; its members remember observed
// spellings and manager merges. Manager display names are presentation text and
// never provider input. The tables stay dark with the v3 aggregate flow.

import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { REVIEW_CAUSE_PHRASE_PATTERN } from '../../review-analysis-v3'
import { REVIEW_TOPICS_V3 } from '../../review-topic-taxonomy'
import {
  propertyTenantForeignKey,
  sqlPatternLiteral,
  sqlStringList,
  timestamptz,
} from './ai-schema-helpers'

const CAUSE_PATTERN = sqlPatternLiteral(REVIEW_CAUSE_PHRASE_PATTERN.source)
const TOPIC_KEY = sql.raw("'__topic__'")

export const aiPropertyIssueGroups = pgTable(
  'ai_property_issue_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    topic: varchar('topic', { length: 40 }).notNull(),
    canonicalThing: varchar('canonical_thing', { length: 80 }),
    canonicalKey: varchar('canonical_key', { length: 100 }).notNull(),
    displayName: varchar('display_name', { length: 80 }),
    mergedIntoIssueId: uuid('merged_into_issue_id'),
    hiddenAt: timestamptz('hidden_at'),
    hiddenBy: varchar('hidden_by', { length: 255 }),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    lastSeenAt: timestamptz('last_seen_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    normalizationVersion: varchar('normalization_version', {
      length: 100,
    }).notNull(),
  },
  (t) => [
    propertyTenantForeignKey(t, 'ai_property_issue_groups_tenant_fk'),
    unique('ai_property_issue_groups_scope_id_topic_unique').on(
      t.organizationId,
      t.propertyId,
      t.id,
      t.topic,
    ),
    foreignKey({
      columns: [t.organizationId, t.propertyId, t.mergedIntoIssueId, t.topic],
      foreignColumns: [t.organizationId, t.propertyId, t.id, t.topic],
      name: 'ai_property_issue_groups_merged_into_fk',
    }).onDelete('cascade'),
    check(
      'ai_property_issue_groups_topic_valid',
      sql`${t.topic} IN (${sqlStringList(REVIEW_TOPICS_V3)})`,
    ),
    check(
      'ai_property_issue_groups_canonical_valid',
      sql`(${t.canonicalKey} = ${TOPIC_KEY} AND ${t.canonicalThing} IS NULL)
        OR (${t.canonicalThing} IS NOT NULL AND ${t.canonicalKey} = ${t.canonicalThing} AND ${t.canonicalThing} ~ ${CAUSE_PATTERN})`,
    ),
    check(
      'ai_property_issue_groups_display_name_valid',
      sql`${t.displayName} IS NULL OR (char_length(${t.displayName}) BETWEEN 1 AND 80 AND ${t.displayName} = btrim(${t.displayName}))`,
    ),
    check(
      'ai_property_issue_groups_hidden_valid',
      sql`(${t.hiddenAt} IS NULL AND ${t.hiddenBy} IS NULL) OR (${t.hiddenAt} IS NOT NULL AND ${t.hiddenBy} IS NOT NULL AND char_length(${t.hiddenBy}) BETWEEN 1 AND 255)`,
    ),
    check(
      'ai_property_issue_groups_not_self_merged',
      sql`${t.mergedIntoIssueId} IS NULL OR ${t.mergedIntoIssueId} <> ${t.id}`,
    ),
    check(
      'ai_property_issue_groups_normalization_version_valid',
      sql`char_length(${t.normalizationVersion}) BETWEEN 1 AND 100`,
    ),
    uniqueIndex('ai_property_issue_groups_canonical_active_unique')
      .on(t.organizationId, t.propertyId, t.topic, t.canonicalKey)
      .where(sql`${t.mergedIntoIssueId} IS NULL`),
    index('ai_property_issue_groups_retention_idx').on(t.expiresAt),
    index('ai_property_issue_groups_merged_into_idx')
      .on(t.organizationId, t.propertyId, t.mergedIntoIssueId)
      .where(sql`${t.mergedIntoIssueId} IS NOT NULL`),
  ],
)

export const aiPropertyIssueMembers = pgTable(
  'ai_property_issue_members',
  {
    issueGroupId: uuid('issue_group_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    topic: varchar('topic', { length: 40 }).notNull(),
    memberKey: varchar('member_key', { length: 100 }).notNull(),
    memberThing: varchar('member_thing', { length: 80 }),
    source: varchar('source', { length: 20 }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
    lastSeenAt: timestamptz('last_seen_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.organizationId, t.propertyId, t.topic, t.memberKey],
      name: 'ai_property_issue_members_pk',
    }),
    foreignKey({
      columns: [t.organizationId, t.propertyId, t.issueGroupId, t.topic],
      foreignColumns: [
        aiPropertyIssueGroups.organizationId,
        aiPropertyIssueGroups.propertyId,
        aiPropertyIssueGroups.id,
        aiPropertyIssueGroups.topic,
      ],
      name: 'ai_property_issue_members_group_fk',
    }).onDelete('cascade'),
    check(
      'ai_property_issue_members_topic_valid',
      sql`${t.topic} IN (${sqlStringList(REVIEW_TOPICS_V3)})`,
    ),
    check(
      'ai_property_issue_members_identity_valid',
      sql`(${t.memberKey} = ${TOPIC_KEY} AND ${t.memberThing} IS NULL)
        OR (${t.memberThing} IS NOT NULL AND ${t.memberKey} = ${t.memberThing} AND ${t.memberThing} ~ ${CAUSE_PATTERN})`,
    ),
    check(
      'ai_property_issue_members_source_valid',
      sql`${t.source} IN ('deterministic', 'manager')`,
    ),
    index('ai_property_issue_members_group_idx').on(t.issueGroupId),
  ],
)
