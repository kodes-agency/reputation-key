import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { ASPECT_TAXONOMY_V1 } from '../../aspect-taxonomy'
import { REPLY_LANGUAGE_TAG_SQL_PATTERN } from '../../reply-language-catalogue'
import { REVIEW_TOPICS_V3 } from '../../review-topic-taxonomy'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { properties } from './property.schema'

const replyTemplateAspectSql = ASPECT_TAXONOMY_V1.map((aspect) => `'${aspect}'`).join(
  ', ',
)

type ReplyVoiceChoices = Readonly<{
  closing: number
  signOff: number
  contactSentence: number
  emoji: number
  includeContact: boolean
}>

/** Layered reply provenance kept with the reply, owned by the reply-library schema. */
export const layeredReplyProvenanceColumns = () => ({
  templateLayer: varchar('template_layer', { length: 20 }),
  templateRef: text('template_ref'),
  templateRevision: integer('template_revision'),
  templateWordingKey: varchar('template_wording_key', { length: 80 }),
  voiceDigest: varchar('voice_digest', { length: 64 }),
  voiceChoices: jsonb('voice_choices').$type<ReplyVoiceChoices>(),
})

export const layeredReplyProvenanceCheck = sql.raw(`(
  (template_layer IS NULL AND template_ref IS NULL AND template_revision IS NULL AND template_wording_key IS NULL)
  OR (template_layer IN ('builtin', 'account', 'property') AND template_ref IS NOT NULL AND template_revision >= 1 AND template_wording_key IS NOT NULL)
)`)

export const replyVoiceDigestCheck = sql.raw(
  "voice_digest IS NULL OR voice_digest ~ '^[0-9a-f]{64}$'",
)

const legacyReplyTemplateProvenanceCheck = sql.raw(`(
  (template_id IS NULL AND template_version IS NULL)
  OR (template_id IS NOT NULL AND template_version >= 1)
)`)

export const replyLibrarySchemaParts = {
  columns: layeredReplyProvenanceColumns,
  layeredProvenanceCheck: layeredReplyProvenanceCheck,
  legacyProvenanceCheck: legacyReplyTemplateProvenanceCheck,
  voiceDigestCheck: replyVoiceDigestCheck,
} as const

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

const replyTopicV3Sql = REVIEW_TOPICS_V3.map((topic) => `'${topic}'`).join(', ')

const replyVoiceColumns = {
  useFirstName: boolean('use_first_name'),
  privacyMode: boolean('privacy_mode'),
  greetingPositive: varchar('greeting_positive', { length: 16 }),
  greetingNegative: varchar('greeting_negative', { length: 16 }),
  contact: varchar('contact', { length: 200 }),
  emojiMode: varchar('emoji_mode', { length: 16 }),
  emojiSet: text('emoji_set').array(),
  signerName: varchar('signer_name', { length: 120 }),
  signerTitle: varchar('signer_title', { length: 120 }),
  businessNameShort: varchar('business_name_short', { length: 120 }),
  visitWordKey: varchar('visit_word_key', { length: 40 }),
  localized: jsonb('localized')
    .$type<Readonly<Record<string, unknown>>>()
    .notNull()
    .default({}),
  overriddenFields: text('overridden_fields')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  version: integer('version').notNull().default(1),
  updatedBy: varchar('updated_by', { length: 255 }).notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}

export const organizationReplyVoices = pgTable(
  'organization_reply_voices',
  {
    organizationId: varchar('organization_id', { length: 255 }).primaryKey(),
    ...replyVoiceColumns,
  },
  (t) => [
    check(
      'organization_reply_voices_greetings_valid',
      sql`(${t.greetingPositive} IS NULL OR ${t.greetingPositive} IN ('hi', 'hello', 'dear')) AND (${t.greetingNegative} IS NULL OR ${t.greetingNegative} IN ('hi', 'hello', 'dear'))`,
    ),
    check(
      'organization_reply_voices_emoji_mode_valid',
      sql`${t.emojiMode} IS NULL OR ${t.emojiMode} IN ('off', 'positive')`,
    ),
    check('organization_reply_voices_version_positive', sql`${t.version} >= 1`),
  ],
)

export const propertyReplyVoices = pgTable(
  'property_reply_voices',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    ...replyVoiceColumns,
  },
  (t) => [
    primaryKey({
      name: 'property_reply_voices_pk',
      columns: [t.organizationId, t.propertyId],
    }),
    foreignKey({
      name: 'property_reply_voices_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    check(
      'property_reply_voices_greetings_valid',
      sql`(${t.greetingPositive} IS NULL OR ${t.greetingPositive} IN ('hi', 'hello', 'dear')) AND (${t.greetingNegative} IS NULL OR ${t.greetingNegative} IN ('hi', 'hello', 'dear'))`,
    ),
    check(
      'property_reply_voices_emoji_mode_valid',
      sql`${t.emojiMode} IS NULL OR ${t.emojiMode} IN ('off', 'positive')`,
    ),
    check('property_reply_voices_version_positive', sql`${t.version} >= 1`),
  ],
)

export const replyTemplates = pgTable(
  'reply_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id'),
    builtinKey: varchar('builtin_key', { length: 80 }),
    basedOnTemplateId: uuid('based_on_template_id').references(
      (): AnyPgColumn => replyTemplates.id,
      { onDelete: 'restrict' },
    ),
    basedOnBuiltinVersion: integer('based_on_builtin_version'),
    currentRevisionId: uuid('current_revision_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    updatedBy: varchar('updated_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('reply_templates_scope_id_key').on(t.organizationId, t.propertyId, t.id),
    index('reply_templates_scope_active_idx').on(
      t.organizationId,
      t.propertyId,
      t.archivedAt,
    ),
    uniqueIndex('reply_templates_account_builtin_unique')
      .on(t.organizationId, t.builtinKey)
      .where(
        sql`property_id IS NULL AND builtin_key IS NOT NULL AND archived_at IS NULL`,
      ),
    uniqueIndex('reply_templates_property_builtin_unique')
      .on(t.organizationId, t.propertyId, t.builtinKey)
      .where(
        sql`property_id IS NOT NULL AND builtin_key IS NOT NULL AND archived_at IS NULL`,
      ),
    uniqueIndex('reply_templates_property_base_unique')
      .on(t.organizationId, t.propertyId, t.basedOnTemplateId)
      .where(
        sql`property_id IS NOT NULL AND based_on_template_id IS NOT NULL AND archived_at IS NULL`,
      ),
    foreignKey({
      name: 'reply_templates_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'reply_templates_current_revision_fk',
      columns: [t.id, t.currentRevisionId],
      foreignColumns: [replyTemplateRevisions.templateId, replyTemplateRevisions.id],
    }).onDelete('restrict'),
    check(
      'reply_templates_base_valid',
      sql`(${t.propertyId} IS NOT NULL OR ${t.basedOnTemplateId} IS NULL) AND num_nonnulls(${t.builtinKey}, ${t.basedOnTemplateId}) <= 1`,
    ),
    check(
      'reply_templates_builtin_version_positive',
      sql`${t.basedOnBuiltinVersion} IS NULL OR ${t.basedOnBuiltinVersion} >= 1`,
    ),
  ],
)

export const replyTemplateRevisions = pgTable(
  'reply_template_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references((): AnyPgColumn => replyTemplates.id, { onDelete: 'restrict' }),
    number: integer('number').notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    starsMin: smallint('stars_min').notNull(),
    starsMax: smallint('stars_max').notNull(),
    reviewKind: varchar('review_kind', { length: 20 }).notNull(),
    topic: varchar('topic', { length: 40 }),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('reply_template_revisions_number_unique').on(t.templateId, t.number),
    uniqueIndex('reply_template_revisions_template_id_key').on(t.templateId, t.id),
    check('reply_template_revisions_number_positive', sql`${t.number} >= 1`),
    check(
      'reply_template_revisions_rating_valid',
      sql`${t.starsMin} BETWEEN 1 AND 5 AND ${t.starsMax} BETWEEN 1 AND 5 AND ${t.starsMin} <= ${t.starsMax}`,
    ),
    check(
      'reply_template_revisions_kind_valid',
      sql`${t.reviewKind} IN ('text', 'rating_only')`,
    ),
    check(
      'reply_template_revisions_topic_valid',
      sql`${t.topic} IS NULL OR ${t.topic} IN (${sql.raw(replyTopicV3Sql)})`,
    ),
    check(
      'reply_template_revisions_title_nonblank',
      sql`char_length(btrim(${t.title})) > 0`,
    ),
  ],
)

export const replyTemplateWordings = pgTable(
  'reply_template_wordings',
  {
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => replyTemplateRevisions.id, { onDelete: 'restrict' }),
    wordingKey: varchar('wording_key', { length: 80 }).notNull(),
    languageGroup: varchar('language_group', { length: 35 }).notNull(),
    body: text('body').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'reply_template_wordings_pk',
      columns: [t.revisionId, t.wordingKey, t.languageGroup],
    }),
    check(
      'reply_template_wordings_language_valid',
      sql`${t.languageGroup} ~ ${sql.raw(`'${REPLY_LANGUAGE_TAG_SQL_PATTERN}'`)}`,
    ),
    check(
      'reply_template_wordings_body_valid',
      sql`octet_length(${t.body}) <= 4096 AND char_length(btrim(${t.body})) > 0`,
    ),
  ],
)

export const replyTemplateVisibility = pgTable(
  'reply_template_visibility',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id'),
    builtinKey: varchar('builtin_key', { length: 80 }),
    templateId: uuid('template_id').references(() => replyTemplates.id, {
      onDelete: 'restrict',
    }),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    foreignKey({
      name: 'reply_template_visibility_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    uniqueIndex('reply_template_visibility_account_builtin_unique')
      .on(t.organizationId, t.builtinKey)
      .where(sql`property_id IS NULL AND builtin_key IS NOT NULL`),
    uniqueIndex('reply_template_visibility_property_builtin_unique')
      .on(t.organizationId, t.propertyId, t.builtinKey)
      .where(sql`property_id IS NOT NULL AND builtin_key IS NOT NULL`),
    uniqueIndex('reply_template_visibility_account_template_unique')
      .on(t.organizationId, t.templateId)
      .where(sql`property_id IS NULL AND template_id IS NOT NULL`),
    uniqueIndex('reply_template_visibility_property_template_unique')
      .on(t.organizationId, t.propertyId, t.templateId)
      .where(sql`property_id IS NOT NULL AND template_id IS NOT NULL`),
    check(
      'reply_template_visibility_one_ref',
      sql`num_nonnulls(${t.builtinKey}, ${t.templateId}) = 1`,
    ),
  ],
)
