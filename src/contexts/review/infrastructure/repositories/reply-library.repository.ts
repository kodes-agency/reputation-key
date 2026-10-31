import { createReserveAiFrame } from './ai-frame-reservation'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { isDeepStrictEqual } from 'node:util'
import type { Database } from '#/shared/db'
import { organization } from '#/shared/db/schema/auth'
import {
  organizationReplyVoices,
  propertyReplyVoices,
  replyTemplateRevisions,
  replyTemplates,
  replyTemplateVisibility,
  replyTemplateWordings,
} from '#/shared/db/schema/reply-library.schema'
import { properties } from '#/shared/db/schema/property.schema'
import {
  googleReplyObservationHeads,
  googleReplyObservations,
  replies,
  reviews,
} from '#/shared/db/schema/review.schema'
import {
  organizationId,
  propertyId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type {
  ReplyVoiceField,
  ReplyVoiceOverride,
  ReplyVoiceSettings,
} from '#/shared/reply-library/reply-voice'
import { isReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import { trace } from '#/shared/observability/trace'
import { BUILTIN_REPLY_LIBRARY_VERSION_NUMBER } from '#/shared/reply-library/builtin-library'
import type {
  ReplyLibraryRepository,
  ReplyLibrarySnapshot,
  SaveReplyTemplateRecord,
  SaveReplyVoiceRecord,
  StoredReplyTemplate,
  StoredReplyTemplateVisibility,
  StoredReplyVoice,
} from '../../application/ports/reply-library.repository'
import type {
  ReplyLibraryRef,
  ReplyLibraryScope,
} from '../../application/dto/reply-library.dto'
import { reviewError } from '../../domain/errors'

type VoiceRow =
  typeof organizationReplyVoices.$inferSelect | typeof propertyReplyVoices.$inferSelect
type MutableVoiceSettings = {
  -readonly [Field in keyof ReplyVoiceSettings]?: ReplyVoiceSettings[Field]
}

const VOICE_FIELDS: readonly ReplyVoiceField[] = [
  'useFirstName',
  'privacyMode',
  'greetingStyle',
  'contact',
  'emojiMode',
  'emojiSet',
  'signerName',
  'signerTitle',
  'businessNameShort',
  'visitWordKey',
]
const VOICE_FIELD_SET = new Set<string>(VOICE_FIELDS)

function voiceFromRow(row: VoiceRow, property: PropertyId | null): StoredReplyVoice {
  const overriddenFields = row.overriddenFields.filter(
    (field): field is ReplyVoiceField => VOICE_FIELD_SET.has(field),
  )
  const values: MutableVoiceSettings = {}
  if (overriddenFields.includes('useFirstName'))
    values.useFirstName = row.useFirstName ?? false
  if (overriddenFields.includes('privacyMode'))
    values.privacyMode = row.privacyMode ?? false
  if (overriddenFields.includes('greetingStyle')) {
    values.greetingStyle = {
      positive: row.greetingPositive as 'hi' | 'hello' | 'dear',
      negative: row.greetingNegative as 'hi' | 'hello' | 'dear',
    }
  }
  if (overriddenFields.includes('contact')) values.contact = row.contact
  if (overriddenFields.includes('emojiMode'))
    values.emojiMode = row.emojiMode as 'off' | 'positive'
  if (overriddenFields.includes('emojiSet')) values.emojiSet = row.emojiSet ?? []
  if (overriddenFields.includes('signerName')) values.signerName = row.signerName
  if (overriddenFields.includes('signerTitle')) values.signerTitle = row.signerTitle
  if (overriddenFields.includes('businessNameShort'))
    values.businessNameShort = row.businessNameShort
  if (overriddenFields.includes('visitWordKey'))
    values.visitWordKey = row.visitWordKey ?? 'visit'
  return {
    organizationId: organizationId(row.organizationId),
    propertyId: property,
    overriddenFields,
    localized: row.localized as ReplyVoiceOverride['localized'],
    version: row.version,
    ...values,
  }
}

function voiceValues(input: Partial<ReplyVoiceSettings>) {
  return {
    useFirstName: input.useFirstName ?? null,
    privacyMode: input.privacyMode ?? null,
    greetingPositive: input.greetingStyle?.positive ?? null,
    greetingNegative: input.greetingStyle?.negative ?? null,
    contact: input.contact ?? null,
    emojiMode: input.emojiMode ?? null,
    emojiSet: input.emojiSet ? [...input.emojiSet] : null,
    signerName: input.signerName ?? null,
    signerTitle: input.signerTitle ?? null,
    businessNameShort: input.businessNameShort ?? null,
    visitWordKey: input.visitWordKey ?? null,
  }
}

function scopePredicate(scope: ReplyLibraryScope, column: AnyPgColumn, id: PropertyId) {
  return scope === 'account' ? isNull(column) : eq(column, id)
}

function parseRef(ref: ReplyLibraryRef): {
  builtinKey: string | null
  templateId: string | null
} {
  return ref.startsWith('builtin:')
    ? { builtinKey: ref.slice('builtin:'.length), templateId: null }
    : { builtinKey: null, templateId: ref.slice('template:'.length) }
}

type TemplateJoined = Readonly<{
  template: typeof replyTemplates.$inferSelect
  revision: typeof replyTemplateRevisions.$inferSelect
  wording: typeof replyTemplateWordings.$inferSelect | null
}>

function templatesFromRows(rows: readonly TemplateJoined[]): StoredReplyTemplate[] {
  const grouped = new Map<string, StoredReplyTemplate>()
  for (const { template, revision, wording } of rows) {
    if (revision.topic !== null && !isReviewTopicV3(revision.topic)) {
      throw reviewError('invalid_row', 'Reply template has an invalid topic')
    }
    if (revision.reviewKind !== 'text' && revision.reviewKind !== 'rating_only') {
      throw reviewError('invalid_row', 'Reply template has an invalid review kind')
    }
    const current = grouped.get(template.id)
    const mapped =
      current ??
      ({
        id: template.id,
        organizationId: organizationId(template.organizationId),
        propertyId: template.propertyId === null ? null : propertyId(template.propertyId),
        builtinKey: template.builtinKey,
        basedOnTemplateId: template.basedOnTemplateId,
        basedOnBuiltinVersion: template.basedOnBuiltinVersion,
        revisionId: revision.id,
        revision: revision.number,
        revisionCreatedAt: revision.createdAt,
        title: revision.title,
        starsMin: revision.starsMin,
        starsMax: revision.starsMax,
        reviewKind: revision.reviewKind,
        topic: revision.topic,
        wordings: [],
      } satisfies StoredReplyTemplate)
    if (wording !== null) {
      ;(mapped.wordings as { key: string; languageGroup: string; body: string }[]).push({
        key: wording.wordingKey,
        languageGroup: wording.languageGroup,
        body: wording.body,
      })
    }
    grouped.set(template.id, mapped)
  }
  return [...grouped.values()]
}

async function loadTemplates(
  db: Database,
  orgId: OrganizationId,
  propId: PropertyId,
): Promise<StoredReplyTemplate[]> {
  const rows = await db
    .select({
      template: replyTemplates,
      revision: replyTemplateRevisions,
      wording: replyTemplateWordings,
    })
    .from(replyTemplates)
    .innerJoin(
      replyTemplateRevisions,
      and(
        eq(replyTemplateRevisions.id, replyTemplates.currentRevisionId),
        eq(replyTemplateRevisions.templateId, replyTemplates.id),
      ),
    )
    .leftJoin(
      replyTemplateWordings,
      eq(replyTemplateWordings.revisionId, replyTemplateRevisions.id),
    )
    .where(
      and(
        eq(replyTemplates.organizationId, orgId),
        isNull(replyTemplates.archivedAt),
        or(isNull(replyTemplates.propertyId), eq(replyTemplates.propertyId, propId)),
      ),
    )
  return templatesFromRows(rows)
}

async function readTemplate(
  db: Pick<Database, 'select'>,
  orgId: OrganizationId,
  propId: PropertyId,
  scope: ReplyLibraryScope,
  condition: ReturnType<typeof eq>,
) {
  const [row] = await db
    .select({ template: replyTemplates, revision: replyTemplateRevisions })
    .from(replyTemplates)
    .innerJoin(
      replyTemplateRevisions,
      eq(replyTemplateRevisions.id, replyTemplates.currentRevisionId),
    )
    .where(
      and(
        eq(replyTemplates.organizationId, orgId),
        scopePredicate(scope, replyTemplates.propertyId, propId),
        isNull(replyTemplates.archivedAt),
        condition,
      ),
    )
    .limit(1)
    .for('update')
  return row ?? null
}

async function saveVoice(db: Database, clock: () => Date, input: SaveReplyVoiceRecord) {
  // fallow-ignore-next-line complexity -- transactional account/property upsert keeps one lock and conflict boundary
  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .limit(1)
      .for('update')
    if (!tenant) return 'version_conflict' as const
    const propertyScope = input.scope === 'property'
    const [current] = propertyScope
      ? await tx
          .select()
          .from(propertyReplyVoices)
          .where(
            and(
              eq(propertyReplyVoices.organizationId, input.organizationId),
              eq(propertyReplyVoices.propertyId, input.propertyId),
            ),
          )
          .limit(1)
      : await tx
          .select()
          .from(organizationReplyVoices)
          .where(eq(organizationReplyVoices.organizationId, input.organizationId))
          .limit(1)
    if ((current?.version ?? 0) !== input.expectedVersion)
      return 'version_conflict' as const
    const currentVoice = current
      ? voiceFromRow(current, propertyScope ? input.propertyId : null)
      : null
    const next: MutableVoiceSettings = {}
    if (currentVoice)
      for (const field of currentVoice.overriddenFields) {
        ;(next as Record<string, unknown>)[field] = currentVoice[field]
      }
    Object.assign(next, input.set)
    const fields = new Set(currentVoice?.overriddenFields ?? [])
    for (const field of Object.keys(input.set) as ReplyVoiceField[]) fields.add(field)
    for (const field of input.reset) {
      fields.delete(field)
      delete (next as Record<string, unknown>)[field]
    }
    const values = {
      ...voiceValues(next),
      localized: mergeLocalizedVoice(currentVoice?.localized ?? {}, input.localized),
      overriddenFields: [...fields],
      updatedBy: input.actorId,
      updatedAt: clock(),
    }
    if (
      currentVoice &&
      isDeepStrictEqual(voiceValues(currentVoice), voiceValues(next)) &&
      isDeepStrictEqual(currentVoice.localized, values.localized) &&
      isDeepStrictEqual([...currentVoice.overriddenFields].sort(), [...fields].sort())
    ) {
      return currentVoice
    }
    if (!current) {
      const inserted = propertyScope
        ? await tx
            .insert(propertyReplyVoices)
            .values({
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              ...values,
            })
            .onConflictDoNothing()
            .returning()
        : await tx
            .insert(organizationReplyVoices)
            .values({ organizationId: input.organizationId, ...values })
            .onConflictDoNothing()
            .returning()
      const row = inserted[0]
      return row
        ? voiceFromRow(row, propertyScope ? input.propertyId : null)
        : ('version_conflict' as const)
    }
    const updated = propertyScope
      ? await tx
          .update(propertyReplyVoices)
          .set({ ...values, version: sql`${propertyReplyVoices.version} + 1` })
          .where(
            and(
              eq(propertyReplyVoices.organizationId, input.organizationId),
              eq(propertyReplyVoices.propertyId, input.propertyId),
              eq(propertyReplyVoices.version, input.expectedVersion),
            ),
          )
          .returning()
      : await tx
          .update(organizationReplyVoices)
          .set({ ...values, version: sql`${organizationReplyVoices.version} + 1` })
          .where(
            and(
              eq(organizationReplyVoices.organizationId, input.organizationId),
              eq(organizationReplyVoices.version, input.expectedVersion),
            ),
          )
          .returning()
    return updated[0]
      ? voiceFromRow(updated[0], propertyScope ? input.propertyId : null)
      : ('version_conflict' as const)
  })
}

async function saveTemplate(
  db: Database,
  clock: () => Date,
  input: SaveReplyTemplateRecord,
) {
  // fallow-ignore-next-line complexity -- transactional create/derive/revise flow keeps one lock and revision boundary
  return db.transaction(async (tx) => {
    const base = input.base ? parseRef(input.base) : null
    if (input.scope === 'account' && base?.templateId) return 'base_unavailable' as const
    if (input.scope === 'property' && base?.templateId) {
      const available = await readTemplate(
        tx,
        input.organizationId,
        input.propertyId,
        'account',
        eq(replyTemplates.id, base.templateId),
      )
      if (!available) return 'base_unavailable' as const
    }
    const condition = input.templateId
      ? eq(replyTemplates.id, input.templateId)
      : base?.builtinKey
        ? eq(replyTemplates.builtinKey, base.builtinKey)
        : base?.templateId
          ? eq(replyTemplates.basedOnTemplateId, base.templateId)
          : undefined
    let current = condition
      ? await readTemplate(
          tx,
          input.organizationId,
          input.propertyId,
          input.scope,
          condition,
        )
      : null
    if (input.templateId && !current) return 'base_unavailable' as const
    if (
      input.expectedVersion !== undefined &&
      current?.revision.number !== input.expectedVersion
    )
      return 'version_conflict' as const
    if (current) {
      const currentWordings = await tx
        .select()
        .from(replyTemplateWordings)
        .where(eq(replyTemplateWordings.revisionId, current.revision.id))
      const normalizedWordings = (
        wordings: readonly {
          key: string
          languageGroup: string
          body: string
        }[],
      ) =>
        wordings
          .map((wording) => ({ ...wording }))
          .sort((left, right) =>
            `${left.key}\0${left.languageGroup}`.localeCompare(
              `${right.key}\0${right.languageGroup}`,
            ),
          )
      const unchanged =
        current.revision.title === input.title &&
        current.revision.starsMin === input.starsMin &&
        current.revision.starsMax === input.starsMax &&
        current.revision.reviewKind === input.reviewKind &&
        current.revision.topic === input.topic &&
        isDeepStrictEqual(
          normalizedWordings(
            currentWordings.map((wording) => ({
              key: wording.wordingKey,
              languageGroup: wording.languageGroup,
              body: wording.body,
            })),
          ),
          normalizedWordings(input.wordings),
        )
      if (unchanged) {
        return templatesFromRows(
          currentWordings.map((wording) => ({
            template: current!.template,
            revision: current!.revision,
            wording,
          })),
        )[0]!
      }
    }
    const scopePropertyId = input.scope === 'property' ? input.propertyId : null
    let templateId = current?.template.id
    if (!templateId) {
      const [created] = await tx
        .insert(replyTemplates)
        .values({
          organizationId: input.organizationId,
          propertyId: scopePropertyId,
          builtinKey: base?.builtinKey,
          basedOnTemplateId: base?.templateId,
          basedOnBuiltinVersion: base?.builtinKey
            ? BUILTIN_REPLY_LIBRARY_VERSION_NUMBER
            : null,
          currentRevisionId: null,
          createdBy: input.actorId,
          updatedBy: input.actorId,
        })
        .onConflictDoNothing()
        .returning({ id: replyTemplates.id })
      if (!created) return 'version_conflict' as const
      templateId = created.id
    }
    const nextNumber = (current?.revision.number ?? 0) + 1
    const [revision] = await tx
      .insert(replyTemplateRevisions)
      .values({
        templateId,
        number: nextNumber,
        title: input.title,
        starsMin: input.starsMin,
        starsMax: input.starsMax,
        reviewKind: input.reviewKind,
        topic: input.topic,
        createdBy: input.actorId,
      })
      .returning()
    if (!revision)
      throw reviewError('repo_upsert_failed', 'Reply template revision insert failed')
    await tx.insert(replyTemplateWordings).values(
      input.wordings.map((wording) => ({
        revisionId: revision.id,
        wordingKey: wording.key,
        languageGroup: wording.languageGroup,
        body: wording.body,
      })),
    )
    const previousRevision = current?.revision.id
    const changed = await tx
      .update(replyTemplates)
      .set({
        currentRevisionId: revision.id,
        updatedBy: input.actorId,
        updatedAt: clock(),
      })
      .where(
        and(
          eq(replyTemplates.organizationId, input.organizationId),
          eq(replyTemplates.id, templateId),
          scopePredicate(input.scope, replyTemplates.propertyId, input.propertyId),
          previousRevision
            ? eq(replyTemplates.currentRevisionId, previousRevision)
            : isNull(replyTemplates.currentRevisionId),
        ),
      )
      .returning()
    if (!changed[0]) return 'version_conflict' as const
    current = { template: changed[0], revision }
    return templatesFromRows(
      input.wordings.map((wording) => ({
        template: current!.template,
        revision,
        wording: {
          revisionId: revision.id,
          wordingKey: wording.key,
          languageGroup: wording.languageGroup,
          body: wording.body,
        },
      })),
    )[0]!
  })
}

export const createReplyLibraryRepository = (
  db: Database,
  clock: () => Date,
): ReplyLibraryRepository => ({
  reserveAiFrame: createReserveAiFrame(db),
  loadSnapshot: (orgId, propId) =>
    trace('replyLibrary.loadSnapshot', async () => {
      const [property] = await db
        .select({
          name: properties.name,
          defaultReplyLanguage: properties.defaultReplyLanguage,
        })
        .from(properties)
        .where(and(eq(properties.organizationId, orgId), eq(properties.id, propId)))
        .limit(1)
      if (!property) return null
      const [[accountVoice], [propertyVoice], templates, visibilityRows] =
        await Promise.all([
          db
            .select()
            .from(organizationReplyVoices)
            .where(eq(organizationReplyVoices.organizationId, orgId))
            .limit(1),
          db
            .select()
            .from(propertyReplyVoices)
            .where(
              and(
                eq(propertyReplyVoices.organizationId, orgId),
                eq(propertyReplyVoices.propertyId, propId),
              ),
            )
            .limit(1),
          loadTemplates(db, orgId, propId),
          db
            .select()
            .from(replyTemplateVisibility)
            .where(
              and(
                eq(replyTemplateVisibility.organizationId, orgId),
                or(
                  isNull(replyTemplateVisibility.propertyId),
                  eq(replyTemplateVisibility.propertyId, propId),
                ),
              ),
            ),
        ])
      const visibility: StoredReplyTemplateVisibility[] = visibilityRows.map((row) => ({
        propertyId: row.propertyId === null ? null : propertyId(row.propertyId),
        ref: (row.builtinKey
          ? `builtin:${row.builtinKey}`
          : `template:${row.templateId}`) as ReplyLibraryRef,
      }))
      return {
        propertyName: property.name,
        defaultReplyLanguage: property.defaultReplyLanguage,
        accountVoice: accountVoice ? voiceFromRow(accountVoice, null) : null,
        propertyVoice: propertyVoice ? voiceFromRow(propertyVoice, propId) : null,
        accountTemplates: templates.filter(({ propertyId: id }) => id === null),
        propertyTemplates: templates.filter(({ propertyId: id }) => id !== null),
        visibility,
      } satisfies ReplyLibrarySnapshot
    }),
  loadVoiceOverridesForShare: (tx, orgId, propId) =>
    trace('replyLibrary.loadVoiceOverridesForShare', async () => {
      const [tenant] = await tx
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, orgId))
        .limit(1)
        .for('share')
      if (!tenant) return null
      const [accountVoice] = await tx
        .select()
        .from(organizationReplyVoices)
        .where(eq(organizationReplyVoices.organizationId, orgId))
        .limit(1)
        .for('share')
      const [propertyVoice] = await tx
        .select()
        .from(propertyReplyVoices)
        .where(
          and(
            eq(propertyReplyVoices.organizationId, orgId),
            eq(propertyReplyVoices.propertyId, propId),
          ),
        )
        .limit(1)
        .for('share')
      return {
        accountVoice: accountVoice ? voiceFromRow(accountVoice, null) : null,
        propertyVoice: propertyVoice ? voiceFromRow(propertyVoice, propId) : null,
      }
    }),
  saveVoice: (input) =>
    trace('replyLibrary.saveVoice', () => saveVoice(db, clock, input)),
  saveTemplate: (input) =>
    trace('replyLibrary.saveTemplate', () => saveTemplate(db, clock, input)),
  setHidden: (input) =>
    trace('replyLibrary.setHidden', async () => {
      const ref = parseRef(input.ref)
      const scope = scopePredicate(
        input.scope,
        replyTemplateVisibility.propertyId,
        input.propertyId,
      )
      const target = ref.builtinKey
        ? eq(replyTemplateVisibility.builtinKey, ref.builtinKey)
        : eq(replyTemplateVisibility.templateId, ref.templateId!)
      const where = and(
        eq(replyTemplateVisibility.organizationId, input.organizationId),
        scope,
        target,
      )
      const [existing] = await db
        .select({ id: replyTemplateVisibility.id })
        .from(replyTemplateVisibility)
        .where(where)
        .limit(1)
      if (input.hidden && !existing)
        await db
          .insert(replyTemplateVisibility)
          .values({
            organizationId: input.organizationId,
            propertyId: input.scope === 'property' ? input.propertyId : null,
            builtinKey: ref.builtinKey,
            templateId: ref.templateId,
            createdBy: input.actorId,
          })
          .onConflictDoNothing()
      if (!input.hidden && existing)
        await db
          .delete(replyTemplateVisibility)
          .where(
            and(
              eq(replyTemplateVisibility.organizationId, input.organizationId),
              eq(replyTemplateVisibility.id, existing.id),
            ),
          )
    }),
  archiveCustomization: (input) =>
    trace('replyLibrary.archiveCustomization', async () => {
      const ref = parseRef(input.ref)
      const target = ref.builtinKey
        ? eq(replyTemplates.builtinKey, ref.builtinKey)
        : input.scope === 'property'
          ? or(
              eq(replyTemplates.basedOnTemplateId, ref.templateId!),
              eq(replyTemplates.id, ref.templateId!),
            )!
          : eq(replyTemplates.id, ref.templateId!)
      const rows = await db
        .update(replyTemplates)
        .set({ archivedAt: clock(), updatedBy: input.actorId, updatedAt: clock() })
        .where(
          and(
            eq(replyTemplates.organizationId, input.organizationId),
            scopePredicate(input.scope, replyTemplates.propertyId, input.propertyId),
            isNull(replyTemplates.archivedAt),
            target,
          ),
        )
        .returning({ id: replyTemplates.id })
      return rows.length > 0
    }),
  findPublishedUsage: (input) =>
    trace('replyLibrary.findPublishedUsage', async () => {
      const rows = await db
        .select({
          wordingKey: replies.templateWordingKey,
          publishedAt: replies.publishedAt,
          voiceChoices: replies.voiceChoices,
        })
        .from(replies)
        .innerJoin(
          reviews,
          and(
            eq(reviews.id, replies.reviewId),
            eq(reviews.organizationId, replies.organizationId),
          ),
        )
        .where(
          and(
            eq(replies.organizationId, input.organizationId),
            eq(reviews.propertyId, input.propertyId),
            eq(replies.status, 'published'),
            sql`${replies.publishedAt} IS NOT NULL`,
            input.templateRef === undefined
              ? undefined
              : eq(replies.templateRef, input.templateRef),
          ),
        )
        .orderBy(desc(replies.publishedAt))
        .limit(100)
      return rows.flatMap((row) =>
        row.publishedAt === null ? [] : [{ ...row, publishedAt: row.publishedAt }],
      )
    }),
  findRecentLiveReplyTexts: (input) =>
    trace('replyLibrary.findRecentLiveReplyTexts', async () => {
      const rows = await db
        .select({ text: googleReplyObservations.normalizedText })
        .from(googleReplyObservationHeads)
        .innerJoin(
          googleReplyObservations,
          and(
            eq(googleReplyObservations.id, googleReplyObservationHeads.observationId),
            eq(
              googleReplyObservations.organizationId,
              googleReplyObservationHeads.organizationId,
            ),
            eq(
              googleReplyObservations.propertyId,
              googleReplyObservationHeads.propertyId,
            ),
            eq(googleReplyObservations.reviewId, googleReplyObservationHeads.reviewId),
          ),
        )
        .where(
          and(
            eq(googleReplyObservationHeads.organizationId, input.organizationId),
            eq(googleReplyObservationHeads.propertyId, input.propertyId),
            sql`${googleReplyObservationHeads.reviewId} <> ${input.excludeReviewId}`,
            eq(googleReplyObservations.state, 'live'),
            eq(googleReplyObservations.contentState, 'active'),
            sql`${googleReplyObservations.normalizedText} IS NOT NULL`,
          ),
        )
        .orderBy(
          desc(googleReplyObservations.providerUpdatedAt),
          desc(googleReplyObservations.observedAt),
        )
        .limit(input.limit)
      return rows.flatMap(({ text }) => (text === null ? [] : [text]))
    }),
})

/**
 * A save sends only the lists it changed, so merge them into what is stored, per
 * language and per list: editing a Spanish closing must not erase English ones.
 */
function mergeLocalizedVoice<T extends object>(
  stored: Readonly<Partial<Record<string, T>>>,
  changes: Readonly<Partial<Record<string, T>>> | undefined,
): Partial<Record<string, T>> {
  if (!changes) return stored
  const merged: Partial<Record<string, T>> = { ...stored }
  for (const [language, locale] of Object.entries(changes)) {
    if (locale === undefined) continue
    const next: Record<string, unknown> = { ...(merged[language] as object | undefined) }
    for (const [section, value] of Object.entries(locale)) {
      const before = next[section]
      next[section] =
        isPlainRecord(value) && isPlainRecord(before) ? { ...before, ...value } : value
    }
    merged[language] = next as T
  }
  return merged
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
