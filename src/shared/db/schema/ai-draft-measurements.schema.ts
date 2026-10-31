import { sql } from 'drizzle-orm'
import {
  pgTable,
  boolean,
  uuid,
  varchar,
  integer,
  bigint,
  doublePrecision,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core'
import { properties } from './property.schema'
import { aiOperations } from './ai.schema'
import { replies } from './review.schema'

const instant = (name: string) => timestamp(name, { withTimezone: true })
/** Tenant-owned usage metadata, deliberately independent of AI authorship. */
export const aiDraftMeasurements = pgTable(
  'ai_draft_measurements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operationId: uuid('operation_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    reviewId: uuid('review_id').notNull(),
    actorUserId: varchar('actor_user_id', { length: 255 }).notNull(),
    requestKey: varchar('request_key', { length: 128 }).notNull(),
    contract: varchar('contract', { length: 2 }).notNull(),
    intent: varchar('intent', { length: 10 }).notNull(),
    trigger: varchar('trigger', { length: 10 }).notNull(),
    tone: varchar('tone', { length: 20 }).notNull(),
    language: varchar('language', { length: 35 }).notNull(),
    ratingBand: varchar('rating_band', { length: 10 }).notNull(),
    case: varchar('case', { length: 40 }),
    providerAttempts: integer('provider_attempts').notNull(),
    outcome: varchar('outcome', { length: 10 }).notNull(),
    refusalCode: varchar('refusal_code', { length: 64 }),
    latencyMs: integer('latency_ms').notNull(),
    baseReplyRevision: bigint('base_reply_revision', { mode: 'number' }).notNull(),
    draftPressed: boolean('draft_pressed').notNull().default(false),
    tryAgainPressed: boolean('try_again_pressed').notNull().default(false),
    shorterPressed: boolean('shorter_pressed').notNull().default(false),
    tonePressed: boolean('tone_pressed').notNull().default(false),
    shownAt: instant('shown_at'),
    dismissedAt: instant('dismissed_at'),
    supersededAt: instant('superseded_at'),
    adoptedAt: instant('adopted_at'),
    adoptedReplyId: uuid('adopted_reply_id'),
    adoptedRevision: bigint('adopted_revision', { mode: 'number' }),
    submittedAt: instant('submitted_at'),
    submittedRevision: bigint('submitted_revision', { mode: 'number' }),
    editDistance: doublePrecision('edit_distance'),
    editedBeforeSubmit: boolean('edited_before_submit'),
    publishedAt: instant('published_at'),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.operationId],
      foreignColumns: [aiOperations.id],
      name: 'ai_draft_measurements_operation_fk',
    }).onDelete('cascade'),
    uniqueIndex('ai_draft_measurements_request_unique').on(
      t.organizationId,
      t.actorUserId,
      t.requestKey,
    ),
    index('ai_draft_measurements_created_idx').on(t.createdAt),
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'ai_draft_measurements_tenant_fk',
    }).onDelete('cascade'),
    check(
      'ai_draft_measurements_contract_valid',
      sql`${t.contract}::text = ANY (ARRAY['v1'::text, 'v2'::text])`,
    ),
    check(
      'ai_draft_measurements_intent_valid',
      sql`${t.intent}::text = ANY (ARRAY['explicit'::text, 'background'::text])`,
    ),
    check(
      'ai_draft_measurements_trigger_valid',
      sql`${t.trigger}::text = ANY (ARRAY['draft'::text, 'try_again'::text, 'shorter'::text, 'tone'::text])`,
    ),
    check(
      'ai_draft_measurements_outcome_valid',
      sql`${t.outcome}::text = ANY (ARRAY['ready'::text, 'refused'::text])`,
    ),
    check(
      'ai_draft_measurements_bounds',
      sql`${t.providerAttempts} >= 1 AND ${t.providerAttempts} <= 2 AND ${t.latencyMs} >= 0 AND ${t.baseReplyRevision} >= 0 AND ${t.baseReplyRevision} <= '9007199254740991'::bigint`,
    ),
    check(
      'ai_draft_measurements_edit_valid',
      sql`(${t.editDistance} IS NULL OR (${t.editDistance} >= 0::double precision AND ${t.editDistance} <= 1::double precision))`,
    ),
  ],
)

/** Content-free generation changes by Reply revision; NULL ends attribution. */
export const aiDraftMeasurementLinks = pgTable(
  'ai_draft_measurement_links',
  {
    replyId: uuid('reply_id').notNull(),
    replyRevision: bigint('reply_revision', { mode: 'number' }).notNull(),
    generationId: uuid('generation_id'),
  },
  (t) => [
    foreignKey({
      columns: [t.replyId],
      foreignColumns: [replies.id],
      name: 'ai_draft_measurement_links_reply_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.generationId],
      foreignColumns: [aiDraftMeasurements.id],
      name: 'ai_draft_measurement_links_generation_fk',
    }).onDelete('cascade'),
    primaryKey({ columns: [t.replyId, t.replyRevision] }),
    index('ai_draft_measurement_links_generation_idx').on(t.generationId),
    check(
      'ai_draft_measurement_links_revision_valid',
      sql`${t.replyRevision} >= 1 AND ${t.replyRevision} <= '9007199254740991'::bigint`,
    ),
  ],
)
