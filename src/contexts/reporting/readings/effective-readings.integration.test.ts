import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema/metric.schema'
import {
  asOfCorrectionTipJoin,
  correctionTipJoin,
  currentCorrectionTips,
  effectiveReadingValue,
  effectiveSampleCount,
  effectiveValue,
} from './effective-readings.server'

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const cutoff = new Date('2026-10-26T00:00:00Z')
const periodStart = new Date('2026-10-24T21:00:00Z')
const periodEnd = new Date('2026-10-25T22:00:00Z')

// Both 03:30 occurrences on Sofia's 25-hour day belong to the event window.
const readings = [
  {
    id: id(1),
    value: 5,
    samples: 2,
    event: '2026-10-25T00:30:00Z',
    recorded: '2026-10-25T00:31:00Z',
  },
  {
    id: id(2),
    value: 4,
    samples: 1,
    event: '2026-10-25T01:30:00Z',
    recorded: '2026-10-25T01:31:00Z',
  },
  {
    id: id(3),
    value: 3,
    samples: 1,
    event: '2026-10-25T12:00:00Z',
    recorded: '2026-10-26T01:00:00Z',
  },
  {
    id: id(4),
    value: 2,
    samples: 3,
    event: '2026-10-25T13:00:00Z',
    recorded: '2026-10-25T13:01:00Z',
  },
  {
    id: id(5),
    value: 1,
    samples: 1,
    event: '2026-10-25T22:00:00Z',
    recorded: '2026-10-25T22:01:00Z',
  },
  {
    id: id(6),
    value: 1,
    samples: 1,
    event: '2026-10-24T21:00:00Z',
    recorded: '2026-10-26T00:00:00Z',
  },
]
const corrections = [
  {
    id: id(11),
    reading: id(1),
    previous: null,
    kind: 'replace',
    replacement: 3,
    delta: null,
    recorded: '2026-10-25T02:00:00Z',
  },
  {
    id: id(10),
    reading: id(1),
    previous: id(11),
    kind: 'adjust',
    replacement: null,
    delta: -1,
    recorded: '2026-10-25T02:00:00Z',
  },
  {
    id: id(13),
    reading: id(2),
    previous: null,
    kind: 'retract',
    replacement: null,
    delta: null,
    recorded: '2026-10-26T00:00:00Z',
  },
  {
    id: id(14),
    reading: id(4),
    previous: null,
    kind: 'replace',
    replacement: 5,
    delta: null,
    recorded: '2026-10-25T14:00:00Z',
  },
  {
    id: id(15),
    reading: id(4),
    previous: id(14),
    kind: 'retract',
    replacement: null,
    delta: null,
    recorded: '2026-10-26T02:00:00Z',
  },
]

function reference(asOf: Date | null, current: boolean) {
  return readings
    .filter((reading) => {
      const event = new Date(reading.event)
      return (
        event >= periodStart &&
        event < periodEnd &&
        (asOf === null || new Date(reading.recorded) < asOf)
      )
    })
    .map((reading) => {
      const visibleCorrections = corrections.filter(
        (correction) =>
          correction.reading === reading.id &&
          (asOf === null || new Date(correction.recorded) < asOf),
      )
      // Current totals follow the chain even when timestamp/ID order disagrees.
      const tip = current
        ? visibleCorrections.find(
            (candidate) =>
              !corrections.some((successor) => successor.previous === candidate.id),
          )
        : visibleCorrections.sort(
            (a, b) => b.recorded.localeCompare(a.recorded) || b.id.localeCompare(a.id),
          )[0]
      const value =
        tip?.kind === 'retract'
          ? null
          : tip?.kind === 'replace'
            ? tip.replacement
            : tip?.kind === 'adjust'
              ? reading.value + (tip.delta ?? 0)
              : reading.value
      return {
        id: reading.id,
        value,
        samples: tip?.kind === 'retract' ? 0 : reading.samples,
      }
    })
}

describe('effective reading SQL against PostgreSQL', () => {
  it.each([
    { label: 'current graph tip', asOf: null, current: true },
    { label: 'live staff scans', asOf: null, current: false },
    { label: 'fixed staff cutoff', asOf: cutoff, current: false },
  ])('matches the independent model for $label', async ({ asOf, current }) => {
    await getDb().transaction(async (tx) => {
      // Temporary relations shadow real tables only on this transaction's connection.
      await tx.execute(sql`CREATE TEMP TABLE metric_readings (
        id uuid, exact_value numeric, sample_count integer,
        event_at timestamptz, recorded_at timestamptz
      ) ON COMMIT DROP`)
      await tx.execute(sql`CREATE TEMP TABLE metric_corrections (
        id uuid, reading_id uuid, supersedes_correction_id uuid,
        kind text, replacement_value numeric, exact_delta numeric, recorded_at timestamptz
      ) ON COMMIT DROP`)
      for (const reading of readings) {
        await tx.execute(sql`INSERT INTO metric_readings VALUES (
          ${reading.id}::uuid, ${reading.value}, ${reading.samples},
          ${reading.event}::timestamptz, ${reading.recorded}::timestamptz
        )`)
      }
      for (const correction of corrections) {
        await tx.execute(sql`INSERT INTO metric_corrections VALUES (
          ${correction.id}::uuid, ${correction.reading}::uuid, ${correction.previous}::uuid,
          ${correction.kind}, ${correction.replacement}, ${correction.delta},
          ${correction.recorded}::timestamptz
        )`)
      }
      const result = await tx.execute(sql`
        SELECT readings.id, ${effectiveReadingValue} AS value
        FROM metric_readings AS readings
        ${current ? correctionTipJoin : asOfCorrectionTipJoin(asOf)}
        WHERE readings.event_at >= ${periodStart} AND readings.event_at < ${periodEnd}
          AND (${asOf}::timestamptz IS NULL OR readings.recorded_at < ${asOf}::timestamptz)
        ORDER BY readings.id
      `)
      const expected = reference(asOf, current)
      expect(
        result.rows.map((row) => ({
          id: row.id,
          value: row.value === null ? null : Number(row.value),
        })),
      ).toEqual(expected.map(({ id, value }) => ({ id, value })))
      if (current) {
        const tips = currentCorrectionTips(tx)
        const currentRows = await tx
          .select({
            id: metricReadings.id,
            value: effectiveValue(tips),
            samples: effectiveSampleCount(tips),
          })
          .from(metricReadings)
          .leftJoin(tips, eq(tips.readingId, metricReadings.id))
          .where(
            sql`${metricReadings.eventAt} >= ${periodStart} AND ${metricReadings.eventAt} < ${periodEnd}`,
          )
          .orderBy(metricReadings.id)
        expect(
          currentRows.map((row) => ({
            ...row,
            value: row.value === null ? null : Number(row.value),
          })),
        ).toEqual(expected)
      }
    })
  })
})
