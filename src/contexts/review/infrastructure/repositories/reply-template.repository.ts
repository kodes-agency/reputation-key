import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  propertyReplyProfiles,
  propertyReplyTemplates,
} from '#/shared/db/schema/reply-library.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { isReplyTemplateAspect } from '#/shared/aspect-taxonomy'
import {
  organizationId,
  propertyId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type {
  PropertyReplyProfile,
  PropertyReplyTemplate,
  ReplyLibraryUpsertResult,
  ReplyProfileWrite,
  ReplyTemplateRepository,
  ReplyTemplateEnabledUpdate,
  ReplyTemplateUpdate,
  ReplyTemplateWrite,
} from '../../application/ports/reply-template.repository'
import {
  replyProfileValuesSchema,
  replyTemplateValuesSchema,
} from '../../application/dto/reply-library.dto'
import { reviewError } from '../../domain/errors'

function profileFromRow(
  row: typeof propertyReplyProfiles.$inferSelect,
): PropertyReplyProfile {
  return {
    ...row,
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
  }
}

function templateFromRow(
  row: typeof propertyReplyTemplates.$inferSelect,
): PropertyReplyTemplate {
  if (row.aspect !== null && !isReplyTemplateAspect(row.aspect)) {
    throw reviewError('invalid_row', 'Reply template has an invalid aspect')
  }
  return {
    ...row,
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    aspect: row.aspect,
  }
}

function validateProfile(input: ReplyProfileWrite): void {
  const result = replyProfileValuesSchema.safeParse({
    greeting: input.greeting,
    signOffPositive: input.signOffPositive,
    signOffNegative: input.signOffNegative,
    emojiAllowed: input.emojiAllowed,
    escalationContact: input.escalationContact,
  })
  if (!result.success) {
    throw reviewError(
      'invalid_input',
      result.error.issues[0]?.message ?? 'Reply profile is invalid',
    )
  }
}

function validateTemplate(input: ReplyTemplateWrite): void {
  const result = replyTemplateValuesSchema.safeParse({
    title: input.title,
    ratingMin: input.ratingMin,
    ratingMax: input.ratingMax,
    hasText: input.hasText,
    aspect: input.aspect,
    openLabel: input.openLabel,
    languageTag: input.languageTag,
    body: input.body,
    enabled: input.enabled,
  })
  if (result.success) return
  const issue = result.error.issues[0]
  const field = issue?.path[0]
  const code =
    field === 'ratingMin' || field === 'ratingMax'
      ? 'invalid_rating'
      : field === 'body'
        ? issue?.code === 'custom'
          ? 'invalid_input'
          : 'invalid_reply'
        : 'invalid_input'
  throw reviewError(code, issue?.message ?? 'Reply template is invalid')
}

function sameProfile(
  current: typeof propertyReplyProfiles.$inferSelect,
  input: ReplyProfileWrite,
): boolean {
  return (
    current.greeting === input.greeting &&
    current.signOffPositive === input.signOffPositive &&
    current.signOffNegative === input.signOffNegative &&
    current.emojiAllowed === input.emojiAllowed &&
    current.escalationContact === input.escalationContact
  )
}

function sameTemplate(
  current: typeof propertyReplyTemplates.$inferSelect,
  input: ReplyTemplateWrite,
): boolean {
  return (
    current.title === input.title &&
    current.ratingMin === input.ratingMin &&
    current.ratingMax === input.ratingMax &&
    current.hasText === input.hasText &&
    current.aspect === input.aspect &&
    current.openLabel === input.openLabel &&
    current.languageTag === input.languageTag &&
    current.body === input.body &&
    current.enabled === input.enabled
  )
}

type TemplateRow = typeof propertyReplyTemplates.$inferSelect
type TemplateScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  templateId: string
}>
type TemplateChanges = Partial<
  Pick<
    ReplyTemplateWrite,
    | 'title'
    | 'ratingMin'
    | 'ratingMax'
    | 'hasText'
    | 'aspect'
    | 'openLabel'
    | 'languageTag'
    | 'body'
    | 'enabled'
  >
>

async function readTemplateRow(
  db: Database,
  input: TemplateScope,
): Promise<TemplateRow | null> {
  const [row] = await db
    .select()
    .from(propertyReplyTemplates)
    .where(
      and(
        eq(propertyReplyTemplates.id, input.templateId),
        eq(propertyReplyTemplates.organizationId, input.organizationId),
        eq(propertyReplyTemplates.propertyId, input.propertyId),
      ),
    )
    .limit(1)
  return row ?? null
}

async function persistTemplateChanges(
  db: Database,
  clock: () => Date,
  current: TemplateRow,
  input: Pick<ReplyTemplateWrite, 'organizationId' | 'propertyId' | 'updatedBy'>,
  changes: TemplateChanges,
): Promise<ReplyLibraryUpsertResult<PropertyReplyTemplate>> {
  const [updated] = await db
    .update(propertyReplyTemplates)
    .set({
      ...changes,
      updatedBy: input.updatedBy,
      version: sql`${propertyReplyTemplates.version} + 1`,
      updatedAt: clock(),
    })
    .where(
      and(
        eq(propertyReplyTemplates.id, current.id),
        eq(propertyReplyTemplates.organizationId, input.organizationId),
        eq(propertyReplyTemplates.propertyId, input.propertyId),
        eq(propertyReplyTemplates.version, current.version),
      ),
    )
    .returning()
  if (!updated) throw reviewError('repo_upsert_failed', 'Reply template update raced')
  return { disposition: 'updated', value: templateFromRow(updated) }
}

async function updateTemplateRow(
  db: Database,
  clock: () => Date,
  current: typeof propertyReplyTemplates.$inferSelect,
  input: ReplyTemplateWrite,
): Promise<ReplyLibraryUpsertResult<PropertyReplyTemplate>> {
  if (sameTemplate(current, input)) {
    return { disposition: 'unchanged', value: templateFromRow(current) }
  }
  return persistTemplateChanges(db, clock, current, input, {
    title: input.title,
    ratingMin: input.ratingMin,
    ratingMax: input.ratingMax,
    hasText: input.hasText,
    aspect: input.aspect,
    openLabel: input.openLabel,
    languageTag: input.languageTag,
    body: input.body,
    enabled: input.enabled,
  })
}

export const createReplyTemplateRepository = (
  db: Database,
  clock: () => Date,
): ReplyTemplateRepository => ({
  findPropertyOrganization: (id: PropertyId) =>
    trace('replyTemplate.findPropertyOrganization', async () => {
      const [row] = await db
        .select({ organizationId: properties.organizationId })
        .from(properties)
        .where(eq(properties.id, id))
        .limit(1)
      return row ? organizationId(row.organizationId) : null
    }),

  findProfile: (orgId: OrganizationId, propId: PropertyId) =>
    trace('replyTemplate.findProfile', async () => {
      const [row] = await db
        .select()
        .from(propertyReplyProfiles)
        .where(
          and(
            eq(propertyReplyProfiles.organizationId, orgId),
            eq(propertyReplyProfiles.propertyId, propId),
          ),
        )
        .limit(1)
      return row ? profileFromRow(row) : null
    }),

  findApplicableTemplates: (input) =>
    trace('replyTemplate.findApplicableTemplates', async () => {
      const rows = await db
        .select()
        .from(propertyReplyTemplates)
        .where(
          and(
            eq(propertyReplyTemplates.organizationId, input.organizationId),
            eq(propertyReplyTemplates.propertyId, input.propertyId),
            eq(propertyReplyTemplates.enabled, true),
            eq(propertyReplyTemplates.hasText, input.hasText),
            lte(propertyReplyTemplates.ratingMin, input.rating),
            gte(propertyReplyTemplates.ratingMax, input.rating),
          ),
        )
        .orderBy(
          asc(propertyReplyTemplates.languageTag),
          sql`${propertyReplyTemplates.aspect} IS NOT NULL`,
          asc(propertyReplyTemplates.title),
        )
      return rows.map(templateFromRow)
    }),
  listPropertyTemplates: (orgId, propId) =>
    trace('replyTemplate.listPropertyTemplates', async () => {
      const rows = await db
        .select()
        .from(propertyReplyTemplates)
        .where(
          and(
            eq(propertyReplyTemplates.organizationId, orgId),
            eq(propertyReplyTemplates.propertyId, propId),
          ),
        )
        .orderBy(
          asc(propertyReplyTemplates.ratingMin),
          asc(propertyReplyTemplates.ratingMax),
          asc(propertyReplyTemplates.title),
        )
      return rows.map(templateFromRow)
    }),

  findEnabledTemplateById: (input) =>
    trace('replyTemplate.findEnabledTemplateById', async () => {
      const row = await readTemplateRow(db, input)
      return row?.enabled ? templateFromRow(row) : null
    }),

  readDefaultReplyLanguage: (orgId, propId) =>
    trace('replyTemplate.readDefaultReplyLanguage', async () => {
      const [row] = await db
        .select({ languageTag: properties.defaultReplyLanguage })
        .from(properties)
        .where(and(eq(properties.organizationId, orgId), eq(properties.id, propId)))
        .limit(1)
      return row?.languageTag ?? null
    }),

  upsertProfile: (input) =>
    trace('replyTemplate.upsertProfile', async () => {
      validateProfile(input)
      const [current] = await db
        .select()
        .from(propertyReplyProfiles)
        .where(
          and(
            eq(propertyReplyProfiles.organizationId, input.organizationId),
            eq(propertyReplyProfiles.propertyId, input.propertyId),
          ),
        )
        .limit(1)
      if (!current) {
        const [created] = await db.insert(propertyReplyProfiles).values(input).returning()
        if (!created)
          throw reviewError('repo_upsert_failed', 'Reply profile insert failed')
        return { disposition: 'inserted', value: profileFromRow(created) }
      }
      if (sameProfile(current, input)) {
        return { disposition: 'unchanged', value: profileFromRow(current) }
      }
      const [updated] = await db
        .update(propertyReplyProfiles)
        .set({
          greeting: input.greeting,
          signOffPositive: input.signOffPositive,
          signOffNegative: input.signOffNegative,
          emojiAllowed: input.emojiAllowed,
          escalationContact: input.escalationContact,
          updatedBy: input.updatedBy,
          version: sql`${propertyReplyProfiles.version} + 1`,
          updatedAt: clock(),
        })
        .where(
          and(
            eq(propertyReplyProfiles.id, current.id),
            eq(propertyReplyProfiles.organizationId, input.organizationId),
            eq(propertyReplyProfiles.propertyId, input.propertyId),
            eq(propertyReplyProfiles.version, current.version),
          ),
        )
        .returning()
      if (!updated) throw reviewError('repo_upsert_failed', 'Reply profile update raced')
      return { disposition: 'updated', value: profileFromRow(updated) }
    }),

  upsertTemplate: (input) =>
    trace('replyTemplate.upsertTemplate', async () => {
      validateTemplate(input)
      const [current] = await db
        .select()
        .from(propertyReplyTemplates)
        .where(
          and(
            eq(propertyReplyTemplates.organizationId, input.organizationId),
            eq(propertyReplyTemplates.propertyId, input.propertyId),
            eq(propertyReplyTemplates.title, input.title),
          ),
        )
        .limit(1)
      if (!current) {
        const [created] = await db
          .insert(propertyReplyTemplates)
          .values(input)
          .returning()
        if (!created)
          throw reviewError('repo_upsert_failed', 'Reply template insert failed')
        return { disposition: 'inserted', value: templateFromRow(created) }
      }
      return updateTemplateRow(db, clock, current, input)
    }),
  updateTemplate: (input: ReplyTemplateUpdate) =>
    trace('replyTemplate.updateTemplate', async () => {
      validateTemplate(input)
      const current = await readTemplateRow(db, input)
      if (!current) return null
      return updateTemplateRow(db, clock, current, input)
    }),
  setTemplateEnabled: (input: ReplyTemplateEnabledUpdate) =>
    trace('replyTemplate.setTemplateEnabled', async () => {
      const current = await readTemplateRow(db, input)
      if (!current) return null
      if (current.enabled === input.enabled) {
        return { disposition: 'unchanged', value: templateFromRow(current) }
      }
      return persistTemplateChanges(db, clock, current, input, {
        enabled: input.enabled,
      })
    }),
})
