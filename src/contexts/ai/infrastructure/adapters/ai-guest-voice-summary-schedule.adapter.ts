// The store behind the Monday email's sweep: which Properties it is the Monday morning of,
// and the one identifier-only fact a summary is recorded as.
//
// The list is a tenant-cross enumeration of ids and timezones, nothing more. Whether it
// is a Property's Monday morning is decided here, in the runtime, rather than in SQL: a
// timezone this runtime does not recognise then drops that Property and not the sweep.
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { insertOutboxRowIfNew } from '#/shared/outbox/commit'
import type {
  AiGuestVoiceSummarySchedulePort,
  GuestVoiceSummaryPublication,
} from '../../application/ports/ai-guest-voice-summary-schedule.port'
import { isSummaryMorning } from '../../application/read-models/guest-voice-v2-summary'
import { aiGuestVoiceSummaryReady } from '../../domain/events'

type Row = Readonly<{ organization_id: string; property_id: string; timezone: string }>

/**
 * A version-5-shaped UUID derived from the Property and its Monday, so the same Monday
 * has the same fact id however often the sweep finds the Property due.
 */
export function guestVoiceSummaryEventId(
  summary: Readonly<{ organizationId: string; propertyId: string; localDate: string }>,
): string {
  const hex = createHash('sha256')
    .update(
      [
        'repkey:ai.guest_voice_summary.ready:v1',
        summary.organizationId,
        summary.propertyId,
        summary.localDate,
      ].join('\u0000'),
    )
    .digest('hex')
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

export const createAiGuestVoiceSummaryScheduleAdapter = (
  db: Database,
): AiGuestVoiceSummarySchedulePort => ({
  async listDue({ nowEpochMillis, limit }) {
    const result = await db.execute(sql`
      SELECT enablement.organization_id, enablement.property_id, profile.timezone
      FROM merchant_ai_enablement AS enablement
      JOIN ai_property_processing_profiles AS profile
        ON profile.organization_id = enablement.organization_id
       AND profile.property_id = enablement.property_id
      WHERE enablement.state = 'enabled'
        AND 'review_analysis' = ANY (enablement.capabilities)
        AND profile.lifecycle_state = 'active'
      ORDER BY enablement.property_id
    `)
    return (result.rows as Row[])
      .filter((row) => isSummaryMorning(nowEpochMillis, row.timezone))
      .slice(0, limit)
      .map((row) => ({
        organizationId: organizationId(row.organization_id),
        propertyId: propertyId(row.property_id),
      }))
  },

  publish({
    organizationId: organization,
    propertyId: property,
    plan,
    occurredAt,
  }: GuestVoiceSummaryPublication) {
    return db.transaction((tx) =>
      insertOutboxRowIfNew(
        tx,
        aiGuestVoiceSummaryReady({
          eventId: guestVoiceSummaryEventId({
            organizationId: organization,
            propertyId: property,
            localDate: plan.localDate,
          }),
          organizationId: organization,
          propertyId: property,
          summaryKind: plan.summaryKind,
          localDate: plan.localDate,
          window: plan.window,
          startLocalDate: plan.startLocalDate,
          endLocalDate: plan.endLocalDate,
          lines: plan.lines,
          occurredAt,
        }),
        { recordedAt: occurredAt },
      ),
    )
  },
})
