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
import { parseCanonicalReplyLanguageTag } from '#/shared/reply-language-catalogue'
import { trace } from '#/shared/observability/trace'
import type {
  PropertyReplyProfile,
  PropertyReplyTemplate,
  ReplyProfileWrite,
  ReplyTemplateRepository,
  ReplyTemplateWrite,
} from '../../application/ports/reply-template.repository'
import { MAX_REPLY_LENGTH, unknownReplyTemplateSlots } from '../../domain/rules'
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
  if (
    input.greeting.length > 120 ||
    input.signOffPositive.length > 200 ||
    input.signOffNegative.length > 200 ||
    (input.escalationContact !== null && input.escalationContact.length > 200)
  ) {
    throw reviewError('invalid_input', 'Reply profile content exceeds its limits')
  }
  const unknownSlots = unknownReplyTemplateSlots(
    [
      input.greeting,
      input.signOffPositive,
      input.signOffNegative,
      input.escalationContact ?? '',
    ].join('\n'),
  )
  if (unknownSlots.length > 0) {
    throw reviewError(
      'invalid_input',
      `Reply profile contains unsupported slots: ${unknownSlots.join(', ')}`,
    )
  }
}

function validateTemplate(input: ReplyTemplateWrite): void {
  if (
    !Number.isInteger(input.ratingMin) ||
    !Number.isInteger(input.ratingMax) ||
    input.ratingMin < 1 ||
    input.ratingMax > 5 ||
    input.ratingMin > input.ratingMax
  ) {
    throw reviewError('invalid_rating', 'Reply template rating band is invalid')
  }
  if (!input.title.trim() || input.title.length > 120) {
    throw reviewError('invalid_input', 'Reply template title is invalid')
  }
  if (input.openLabel !== null && input.openLabel.length > 80) {
    throw reviewError('invalid_input', 'Reply template open label is invalid')
  }
  if (!input.body.trim() || input.body.length > MAX_REPLY_LENGTH) {
    throw reviewError('invalid_reply', 'Reply template body is invalid')
  }
  if (input.aspect !== null && !isReplyTemplateAspect(input.aspect)) {
    throw reviewError(
      'invalid_input',
      `Reply template aspect is invalid: ${input.aspect}`,
    )
  }
  if (parseCanonicalReplyLanguageTag(input.languageTag) === null) {
    throw reviewError(
      'invalid_input',
      `Reply template language is invalid: ${input.languageTag}`,
    )
  }
  const unknownSlots = unknownReplyTemplateSlots(input.body)
  if (unknownSlots.length > 0) {
    throw reviewError(
      'invalid_input',
      `Reply template contains unsupported slots: ${unknownSlots.join(', ')}`,
    )
  }
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

  findEnabledTemplateById: (input) =>
    trace('replyTemplate.findEnabledTemplateById', async () => {
      const [row] = await db
        .select()
        .from(propertyReplyTemplates)
        .where(
          and(
            eq(propertyReplyTemplates.id, input.templateId),
            eq(propertyReplyTemplates.organizationId, input.organizationId),
            eq(propertyReplyTemplates.propertyId, input.propertyId),
            eq(propertyReplyTemplates.enabled, true),
          ),
        )
        .limit(1)
      return row ? templateFromRow(row) : null
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
      if (sameTemplate(current, input)) {
        return { disposition: 'unchanged', value: templateFromRow(current) }
      }
      const [updated] = await db
        .update(propertyReplyTemplates)
        .set({
          ratingMin: input.ratingMin,
          ratingMax: input.ratingMax,
          hasText: input.hasText,
          aspect: input.aspect,
          openLabel: input.openLabel,
          languageTag: input.languageTag,
          body: input.body,
          enabled: input.enabled,
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
    }),
})
