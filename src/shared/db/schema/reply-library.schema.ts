import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { ASPECT_TAXONOMY_V1 } from '../../aspect-taxonomy'
import { REPLY_LANGUAGE_TAG_SQL_PATTERN } from '../../reply-language-catalogue'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { properties } from './property.schema'

const replyTemplateAspectSql = ASPECT_TAXONOMY_V1.map((aspect) => `'${aspect}'`).join(
  ', ',
)

export const propertyReplyProfiles = pgTable(
  'property_reply_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    greeting: varchar('greeting', { length: 120 }).notNull(),
    signOffPositive: varchar('sign_off_positive', { length: 200 }).notNull(),
    signOffNegative: varchar('sign_off_negative', { length: 200 }).notNull(),
    emojiAllowed: boolean('emoji_allowed').notNull().default(false),
    escalationContact: varchar('escalation_contact', { length: 200 }),
    version: integer('version').notNull().default(1),
    updatedBy: varchar('updated_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('property_reply_profiles_property_unique').on(
      t.organizationId,
      t.propertyId,
    ),
    uniqueIndex('property_reply_profiles_scope_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    foreignKey({
      name: 'property_reply_profiles_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    check('property_reply_profiles_version_positive', sql`${t.version} >= 1`),
  ],
)

export const propertyReplyTemplates = pgTable(
  'property_reply_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    ratingMin: smallint('rating_min').notNull(),
    ratingMax: smallint('rating_max').notNull(),
    hasText: boolean('has_text').notNull(),
    aspect: varchar('aspect', { length: 40 }),
    openLabel: varchar('open_label', { length: 80 }),
    languageTag: varchar('language_tag', { length: 35 }).notNull(),
    body: text('body').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    version: integer('version').notNull().default(1),
    updatedBy: varchar('updated_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('property_reply_templates_property_title_unique').on(
      t.organizationId,
      t.propertyId,
      t.title,
    ),
    uniqueIndex('property_reply_templates_scope_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    index('property_reply_templates_applicable_idx').on(
      t.organizationId,
      t.propertyId,
      t.enabled,
      t.hasText,
      t.ratingMin,
      t.ratingMax,
    ),
    foreignKey({
      name: 'property_reply_templates_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    check(
      'property_reply_templates_rating_valid',
      sql`${t.ratingMin} BETWEEN 1 AND 5 AND ${t.ratingMax} BETWEEN 1 AND 5 AND ${t.ratingMin} <= ${t.ratingMax}`,
    ),
    check(
      'property_reply_templates_aspect_valid',
      sql`${t.aspect} IS NULL OR ${t.aspect} IN (${sql.raw(replyTemplateAspectSql)})`,
    ),
    check(
      'property_reply_templates_language_tag_valid',
      sql`${t.languageTag} ~ ${sql.raw(`'${REPLY_LANGUAGE_TAG_SQL_PATTERN}'`)}`,
    ),
    check(
      'property_reply_templates_body_valid',
      sql`char_length(btrim(${t.body})) > 0 AND char_length(${t.body}) <= 4096`,
    ),
    check(
      'property_reply_templates_title_nonempty',
      sql`char_length(btrim(${t.title})) > 0`,
    ),
    check('property_reply_templates_version_positive', sql`${t.version} >= 1`),
  ],
)
