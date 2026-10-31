import { and, eq, gt, or, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  properties,
  replies,
  reviews,
  replyAiFrameReservations,
} from '#/shared/db/schema'
import {
  pickLeastRecentlyUsed,
  type ReplyRotationUsage,
} from '#/shared/reply-library/reply-rotation'
import type { ReplyLibraryRepository } from '../../application/ports/reply-library.repository'
import type { ReplyVoiceChoices } from '#/shared/reply-drafting-v2-binding'

type ReservationInput = Parameters<
  NonNullable<ReplyLibraryRepository['reserveAiFrame']>
>[0]
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
type Field = 'closing' | 'signOff' | 'contactSentence' | 'emoji'
type UsageRow = Readonly<{ choices: ReplyVoiceChoices | null; usedAt: number }>

function orderOptions(
  count: number,
  usage: readonly ReplyRotationUsage[],
  seed: string,
): number[] {
  const remaining = Array.from({ length: count }, (_, index) => String(index))
  const ordered: number[] = []
  while (remaining.length) {
    const chosen = pickLeastRecentlyUsed(remaining, usage, seed)!
    ordered.push(Number(chosen))
    remaining.splice(remaining.indexOf(chosen), 1)
  }
  return ordered
}

function reservationScope(input: ReservationInput) {
  return [
    eq(replyAiFrameReservations.organizationId, input.organizationId),
    eq(replyAiFrameReservations.propertyId, input.propertyId),
    eq(replyAiFrameReservations.languageGroup, input.languageGroup),
    eq(replyAiFrameReservations.ratingBand, input.ratingBand),
    eq(replyAiFrameReservations.voiceDigest, input.voiceDigest),
  ]
}

async function generationUsage(
  tx: Tx,
  input: ReservationInput,
): Promise<readonly UsageRow[]> {
  await tx
    .delete(replyAiFrameReservations)
    .where(
      and(
        ...reservationScope(input),
        isNull(replyAiFrameReservations.adoptedAt),
        lte(
          replyAiFrameReservations.createdAt,
          new Date(input.nowEpochMillis - 15 * 60_000),
        ),
      ),
    )
  // Aggregate every eligible use, rather than truncating another band's history.
  return tx
    .select({
      choices: replyAiFrameReservations.choices,
      usedAt:
        sql<number>`max(extract(epoch from coalesce(${replyAiFrameReservations.adoptedAt}, ${replyAiFrameReservations.createdAt})) * 1000)`.mapWith(
          Number,
        ),
    })
    .from(replyAiFrameReservations)
    .where(
      and(
        ...reservationScope(input),
        or(
          isNotNull(replyAiFrameReservations.adoptedAt),
          gt(
            replyAiFrameReservations.createdAt,
            new Date(input.nowEpochMillis - 15 * 60_000),
          ),
        ),
      ),
    )
    .groupBy(replyAiFrameReservations.choices)
}

async function publishedTemplateUsage(
  tx: Tx,
  input: ReservationInput,
): Promise<readonly UsageRow[]> {
  // Historical rows without a recorded frame band stay unknown. A source edit
  // must never reinterpret a positive option index as a negative option index.
  const band = sql<string>`${replies.voiceChoices}->>'ratingBand'`
  return tx
    .select({
      choices: replies.voiceChoices,
      usedAt: sql<number>`max(extract(epoch from ${replies.publishedAt}) * 1000)`.mapWith(
        Number,
      ),
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
        eq(replies.voiceDigest, input.voiceDigest),
        eq(band, input.ratingBand),
        or(
          eq(replies.originTemplateGroup, input.languageGroup),
          eq(replies.replyLanguageTag, input.languageGroup),
        ),
        eq(replies.status, 'published'),
        isNotNull(replies.templateRef),
        isNotNull(replies.publishedAt),
        isNotNull(replies.voiceChoices),
      ),
    )
    .groupBy(replies.voiceChoices)
}

function chooseFrame(input: ReservationInput, rows: readonly UsageRow[]) {
  const usage = (field: Field) =>
    rows.flatMap((row) =>
      row.choices === null
        ? []
        : [{ key: String(row.choices[field]), usedAtEpochMillis: row.usedAt }],
    )
  const ordered = (field: Field) =>
    orderOptions(
      input.optionCounts[field],
      usage(field),
      `${input.generationSeed}:${field}`,
    )
  const closingOrder = ordered('closing')
  return {
    closingOrder,
    choices: {
      closing: closingOrder[0] ?? -1,
      signOff: ordered('signOff')[0] ?? 0,
      contactSentence: ordered('contactSentence')[0] ?? 0,
      emoji: ordered('emoji')[0] ?? 0,
      includeContact: true,
    },
  }
}

export function createReserveAiFrame(
  db: Database,
): NonNullable<ReplyLibraryRepository['reserveAiFrame']> {
  return (input) =>
    db.transaction(async (tx) => {
      // Serializes simultaneous generation for this Property, including unused options.
      const [property] = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            eq(properties.id, input.propertyId),
            eq(properties.organizationId, input.organizationId),
          ),
        )
        .for('no key update')
      if (!property) return null
      const [existing] = await tx
        .select()
        .from(replyAiFrameReservations)
        .where(
          and(
            ...reservationScope(input),
            eq(replyAiFrameReservations.generationSeed, input.generationSeed),
          ),
        )
      if (existing)
        return { choices: existing.choices, closingOrder: existing.closingOrder }
      const generated = await generationUsage(tx, input)
      const published = await publishedTemplateUsage(tx, input)
      const selected = chooseFrame(input, [...generated, ...published])
      // A monotonic reservation time also rotates calls arriving in the same millisecond.
      const lastUse = generated.reduce(
        (latest, row) => Math.max(latest, row.usedAt),
        -Infinity,
      )
      await tx.insert(replyAiFrameReservations).values({
        ...selected,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        languageGroup: input.languageGroup,
        ratingBand: input.ratingBand,
        voiceDigest: input.voiceDigest,
        generationSeed: input.generationSeed,
        createdAt: new Date(Math.max(input.nowEpochMillis, lastUse + 1)),
      })
      return selected
    })
}
